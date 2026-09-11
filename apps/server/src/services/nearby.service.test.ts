import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';

// ─── Mock Redis (shared with presence.service via getRedisClient) ────────────

const mockGet = vi.fn().mockResolvedValue(null);
const mockSet = vi.fn().mockResolvedValue('OK');
const mockOn = vi.fn();

const mockRedisClient = {
  get: mockGet,
  set: mockSet,
  on: mockOn,
} as unknown as Redis;

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockRedisClient),
}));

import { setRedisClient } from './presence.service.js';
import {
  buildOverpassQuery,
  toNearbyResult,
  isValidCategory,
  searchNearby,
  CATEGORY_PRESETS,
} from './nearby.service.js';

describe('Nearby Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
    setRedisClient(mockRedisClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isValidCategory', () => {
    it('accepts every preset category', () => {
      for (const category of Object.keys(CATEGORY_PRESETS)) {
        expect(isValidCategory(category)).toBe(true);
      }
    });

    it('rejects unknown or unsafe values', () => {
      expect(isValidCategory('bank')).toBe(false);
      expect(isValidCategory('')).toBe(false);
      expect(isValidCategory('amenity=cafe')).toBe(false);
    });
  });

  describe('buildOverpassQuery', () => {
    it('maps a category preset to its OSM tag and includes the around filter', () => {
      const query = buildOverpassQuery('cafe', 35.6586, 139.7454, 500, 50);
      expect(query).toContain('[out:json]');
      expect(query).toContain('["amenity"="cafe"]');
      expect(query).toContain('(around:500,35.6586,139.7454)');
      // Queries node/way/relation so area-mapped POIs are caught too.
      expect(query).toContain('node["amenity"="cafe"]');
      expect(query).toContain('way["amenity"="cafe"]');
      expect(query).toContain('relation["amenity"="cafe"]');
      // `out center <limit>` gives ways/relations a representative point.
      expect(query).toContain('out center 50;');
    });

    it('uses the tourism key for attractions', () => {
      const query = buildOverpassQuery('attraction', 10, 20, 1000, 10);
      expect(query).toContain('["tourism"="attraction"]');
      expect(query).toContain('(around:1000,10,20)');
    });
  });

  describe('toNearbyResult', () => {
    it('normalizes a node element with a name', () => {
      const result = toNearbyResult(
        { type: 'node', lat: 35.66, lon: 139.74, tags: { name: 'Blue Bottle', cuisine: 'coffee_shop' } },
        'cafe'
      );
      expect(result).toEqual({
        name: 'Blue Bottle',
        latitude: 35.66,
        longitude: 139.74,
        category: 'cafe',
        tags: { name: 'Blue Bottle', cuisine: 'coffee_shop' },
      });
    });

    it('reads coordinates from `center` for way/relation elements', () => {
      const result = toNearbyResult(
        { type: 'way', center: { lat: 1.23, lon: 4.56 }, tags: { name: 'Big Park' } },
        'attraction'
      );
      expect(result?.latitude).toBe(1.23);
      expect(result?.longitude).toBe(4.56);
    });

    it('drops unnamed results', () => {
      expect(toNearbyResult({ lat: 1, lon: 2, tags: { amenity: 'cafe' } }, 'cafe')).toBeNull();
      expect(toNearbyResult({ lat: 1, lon: 2 }, 'cafe')).toBeNull();
    });

    it('drops results without usable or in-range coordinates', () => {
      expect(toNearbyResult({ tags: { name: 'Nowhere' } }, 'cafe')).toBeNull();
      expect(toNearbyResult({ lat: 999, lon: 0, tags: { name: 'Off map' } }, 'cafe')).toBeNull();
    });
  });

  describe('searchNearby', () => {
    it('returns a cached payload without calling Overpass', async () => {
      const cached = [
        { name: 'Cached Cafe', latitude: 1, longitude: 2, category: 'cafe', tags: { name: 'Cached Cafe' } },
      ];
      mockGet.mockResolvedValueOnce(JSON.stringify(cached));
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const results = await searchNearby('cafe', 1, 2, { radius: 500 });

      expect(results).toEqual(cached);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('queries Overpass on a cache miss, drops unnamed results, and caches the result', async () => {
      mockGet.mockResolvedValue(null);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            elements: [
              { type: 'node', lat: 35.66, lon: 139.74, tags: { name: 'Named Cafe' } },
              { type: 'node', lat: 35.67, lon: 139.75, tags: { amenity: 'cafe' } }, // unnamed → dropped
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const results = await searchNearby('cafe', 35.66, 139.74, { radius: 300 });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Named Cafe');
      // Result was written back to the cache.
      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });
});
