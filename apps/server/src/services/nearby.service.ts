import { createHash } from 'crypto';

import { getRedisClient } from './presence.service.js';

/**
 * Server-side "nearby places" search via the Overpass API (OpenStreetMap).
 *
 * This mirrors `geocode.service.ts` and lives on the server for the same
 * reasons: Overpass is rate-limited, can be slow, and its usage policy expects
 * an identifying User-Agent that a browser will not let us set. So the browser
 * talks to `/api/nearby` and this module is the only thing that talks to
 * Overpass, which lets us enforce centrally:
 *
 *   1. A serialized outbound throttle (`schedule`), spacing calls apart.
 *   2. Aggressive Redis caching keyed on rounded coordinates + category +
 *      radius, so repeat category clicks never leave the box.
 *   3. A valid User-Agent + Referer on every outbound call.
 *
 * See https://dev.overpass-api.de/overpass-doc/en/ and
 * https://operations.osmfoundation.org/policies/api/
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const OVERPASS_BASE_URL = (
  process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter'
).replace(/\/+$/, '');

/**
 * Overpass, like Nominatim, wants a User-Agent that identifies the application.
 * Reuses the geocode identity by default so a single env override configures
 * both proxies, but can be overridden independently.
 */
const USER_AGENT =
  process.env.NEARBY_USER_AGENT ||
  process.env.GEOCODE_USER_AGENT ||
  'TripSync/1.0 (self-hosted; contact: admin@localhost)';
const REFERER = process.env.NEARBY_REFERER || process.env.GEOCODE_REFERER || 'https://localhost';

/**
 * Overpass allows a couple of requests per second but throttles heavy usage.
 * 1.1s between calls keeps us comfortably polite; the cache keeps real volume
 * far below this.
 */
const MIN_REQUEST_INTERVAL_MS = 1100;
/** Overpass can be genuinely slow, so this timeout is generous on purpose. */
const REQUEST_TIMEOUT_MS = 25000;
/** Passed to Overpass QL `[timeout:..]` (seconds); slightly under our own timeout. */
const OVERPASS_QL_TIMEOUT_S = 20;

/** Bump when the cached payload shape changes, so old entries are ignored. */
const CACHE_VERSION = 'v1';
const RESULT_CACHE_TTL = 60 * 60 * 24; // 1 day — POIs are fairly stable
/** Empty results are cached briefly so an empty area isn't re-queried repeatedly. */
const EMPTY_CACHE_TTL = 60 * 10; // 10 minutes

const MIN_RADIUS = 50;
const MAX_RADIUS = 5000;
export const DEFAULT_RADIUS = 500;
/** Cap on results returned to the client, also passed to Overpass `out`. */
const MAX_RESULTS = 50;

/** Coordinates are rounded to this many decimals for the cache key (~110m at 3dp). */
const CACHE_COORD_PRECISION = 3;

// ─── Category presets ────────────────────────────────────────────────────────

/**
 * Maps a client-facing category key to the OSM tag it filters on. These are the
 * only categories the proxy will query — anything else is rejected by the route.
 */
export const CATEGORY_PRESETS: Record<string, { key: string; value: string }> = {
  cafe: { key: 'amenity', value: 'cafe' },
  restaurant: { key: 'amenity', value: 'restaurant' },
  atm: { key: 'amenity', value: 'atm' },
  pharmacy: { key: 'amenity', value: 'pharmacy' },
  fuel: { key: 'amenity', value: 'fuel' },
  attraction: { key: 'tourism', value: 'attraction' },
};

export type NearbyCategory = keyof typeof CATEGORY_PRESETS;

export function isValidCategory(value: string): value is NearbyCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_PRESETS, value);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NearbyResult {
  /** POI display name (from OSM `name`); unnamed results are dropped. */
  name: string;
  latitude: number;
  longitude: number;
  /** The requested category key, e.g. "cafe". */
  category: string;
  /** Raw OSM tags, useful for popups (cuisine, opening_hours, etc.). */
  tags: Record<string, string>;
}

export interface NearbyOptions {
  radius?: number;
  limit?: number;
}

// ─── Outbound request throttle ───────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;
/** Tail of the serialized request chain. Never rejects, so one failure can't stall the queue. */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Serializes every outbound Overpass call and spaces them at least
 * MIN_REQUEST_INTERVAL_MS apart, process-wide. Per-process, same trade-off as
 * the geocode proxy: the cache keeps real volume low enough that this is fine.
 */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  };

  // `.then(run, run)` so a rejected predecessor still lets this task proceed.
  const result = queueTail.then(run, run);
  queueTail = result.catch(() => undefined);
  return result;
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function roundCoord(value: number): string {
  return value.toFixed(CACHE_COORD_PRECISION);
}

function cacheKey(parts: (string | number)[]): string {
  const hash = createHash('sha1').update(parts.join('\u0000')).digest('hex');
  return `nearby:${CACHE_VERSION}:${hash}`;
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    // A cache outage must not take nearby search down with it.
    console.error('Nearby cache read failed:', (error as Error).message);
    return null;
  }
}

async function writeCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    console.error('Nearby cache write failed:', (error as Error).message);
  }
}

// ─── Overpass query + parsing ─────────────────────────────────────────────────

/**
 * Builds an Overpass QL query for a single tag around a point. Queries node,
 * way, and relation so we catch POIs mapped as areas (e.g. a large attraction)
 * as well as single points, and `out center` gives areas a representative
 * lat/lng.
 */
export function buildOverpassQuery(
  category: NearbyCategory,
  lat: number,
  lng: number,
  radius: number,
  limit: number
): string {
  const { key, value } = CATEGORY_PRESETS[category];
  const filter = `["${key}"="${value}"]`;
  const around = `(around:${radius},${lat},${lng})`;
  return (
    `[out:json][timeout:${OVERPASS_QL_TIMEOUT_S}];` +
    `(` +
    `node${filter}${around};` +
    `way${filter}${around};` +
    `relation${filter}${around};` +
    `);` +
    `out center ${limit};`
  );
}

/** Coerces an OSM tags object into a plain string map, ignoring non-string values. */
function normalizeTags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') tags[k] = v;
  }
  return tags;
}

/**
 * Maps a raw Overpass element to our shape, returning null for anything without
 * a usable name or coordinates. Ways/relations carry their point in `center`.
 */
export function toNearbyResult(raw: any, category: string): NearbyResult | null {
  const tags = normalizeTags(raw?.tags);
  const name = typeof tags.name === 'string' ? tags.name.trim() : '';
  if (!name) return null; // Drop unnamed results.

  const latitude = Number(raw?.lat ?? raw?.center?.lat);
  const longitude = Number(raw?.lon ?? raw?.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return { name, latitude, longitude, category, tags };
}

// ─── Core request ────────────────────────────────────────────────────────────

/** Raised when Overpass itself fails, carrying the status to surface to the client. */
export class NearbyUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'NearbyUpstreamError';
  }
}

async function requestOverpass(query: string): Promise<unknown> {
  return schedule(async () => {
    const response = await fetch(OVERPASS_BASE_URL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: REFERER,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // Overpass reads the query from a `data` form field on POST.
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 429 (too many requests) and 504 (server load) are transient upstream
      // conditions — surface them as 503 so the client can retry later.
      throw new NearbyUpstreamError(
        `Overpass responded ${response.status}`,
        response.status === 429 || response.status === 504 ? 503 : 502
      );
    }

    return response.json();
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Finds named POIs of `category` within `radius` meters of a point. Cached in
 * Redis keyed on rounded coordinates + category + radius; only cache misses
 * reach Overpass.
 */
export async function searchNearby(
  category: NearbyCategory,
  lat: number,
  lng: number,
  { radius = DEFAULT_RADIUS, limit = MAX_RESULTS }: NearbyOptions = {}
): Promise<NearbyResult[]> {
  const effectiveRadius = Math.min(Math.max(Math.round(radius), MIN_RADIUS), MAX_RADIUS);
  const effectiveLimit = Math.min(Math.max(1, Math.round(limit)), MAX_RESULTS);

  const key = cacheKey([
    'search',
    category,
    roundCoord(lat),
    roundCoord(lng),
    effectiveRadius,
    effectiveLimit,
  ]);

  const cached = await readCache<NearbyResult[]>(key);
  if (cached) return cached;

  const query = buildOverpassQuery(category, lat, lng, effectiveRadius, effectiveLimit);
  const raw = (await requestOverpass(query)) as { elements?: unknown };
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];

  const seen = new Set<string>();
  const results: NearbyResult[] = [];
  for (const element of elements) {
    const result = toNearbyResult(element, category);
    if (!result) continue;
    // Ways/relations can duplicate a node for the same place; de-dupe by name+coords.
    const dedupeKey = `${result.name}\u0000${roundCoord(result.latitude)}\u0000${roundCoord(result.longitude)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push(result);
    if (results.length >= effectiveLimit) break;
  }

  await writeCache(key, results, results.length > 0 ? RESULT_CACHE_TTL : EMPTY_CACHE_TTL);
  return results;
}

/** Exposed for the route's response so the UI can show OSM attribution. */
export const NEARBY_ATTRIBUTION = '© OpenStreetMap contributors';

export const NEARBY_LIMITS = { MIN_RADIUS, MAX_RADIUS, DEFAULT_RADIUS, MAX_RESULTS };
