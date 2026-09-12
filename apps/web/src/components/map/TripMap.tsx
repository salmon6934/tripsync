'use client';

/**
 * Map tab container: loads the trip's days/blocks, turns them into day-colored
 * pins plus chronological routes, and renders them with a day filter alongside
 * the Leaflet map.
 *
 * All Leaflet-specific rendering lives in `MapView` (loaded client-side only
 * through `@/components/map`), so this component stays plain React.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import type { ActivityCategory } from '@tripsync/shared';
import {
  assignDayColors,
  buildRouteSegments,
  formatDistance,
  formatDuration,
  groupPinsByDay,
  toMapPins,
  withEstimatedDistances,
  type BlockLike,
  type MapPin,
} from '@/lib/map-utils';
import { formatTime, timezoneAbbreviation } from '@/lib/format';
import { useSocket } from '@/hooks/useSocket';
import { useNearbySearch, type NearbyResult } from '@/hooks/useNearbySearch';
import { AddActivityModal } from '@/components/itinerary/AddActivityModal';
import { MapView } from './index';
import { DayFilter, type DayFilterEntry } from './DayFilter';

/**
 * Nearby-search category presets shown in the map's category bar. `key` matches
 * the backend Overpass proxy preset; `activityCategory` is what an added POI
 * becomes when saved as an itinerary block.
 */
const NEARBY_CATEGORIES: {
  key: string;
  label: string;
  emoji: string;
  activityCategory: ActivityCategory;
}[] = [
  { key: 'cafe', label: 'Cafes', emoji: '☕', activityCategory: 'food' },
  { key: 'restaurant', label: 'Restaurants', emoji: '🍽️', activityCategory: 'food' },
  { key: 'attraction', label: 'Attractions', emoji: '🎯', activityCategory: 'activity' },
  { key: 'atm', label: 'ATMs', emoji: '🏧', activityCategory: 'activity' },
  { key: 'pharmacy', label: 'Pharmacy', emoji: '💊', activityCategory: 'activity' },
  { key: 'fuel', label: 'Fuel', emoji: '⛽', activityCategory: 'travel' },
];

/** Radius (m) for the nearby POI search — a walkable neighbourhood around a pin. */
const NEARBY_RADIUS_M = 800;

function activityCategoryFor(nearbyCategory: string | null): ActivityCategory {
  return NEARBY_CATEGORIES.find((c) => c.key === nearbyCategory)?.activityCategory ?? 'activity';
}

interface ApiBlock {
  id: string;
  title: string;
  category: ActivityCategory;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface ApiDay {
  id: string;
  dayNumber: number;
  date: string;
  blocks: ApiBlock[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function TripMap() {
  const { data: session } = useSession();
  const params = useParams();
  const tripId = params.id as string;
  const token = (session as { accessToken?: string } | null)?.accessToken;

  const [days, setDays] = useState<ApiDay[]>([]);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hiddenDays, setHiddenDays] = useState<Set<number>>(new Set());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  /** Nearby result currently being added to the itinerary (drives the modal). */
  const [addingNearby, setAddingNearby] = useState<NearbyResult | null>(null);

  const {
    results: nearbyResults,
    origin: nearbyOrigin,
    category: nearbyCategory,
    loading: nearbyLoading,
    error: nearbyError,
    searched: nearbySearched,
    search: runNearbySearch,
    clear: clearNearby,
  } = useNearbySearch(token);

  // ─── Data ────────────────────────────────────────────────────────────────

  const fetchDays = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/days`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load map data');
      const data = await res.json();
      setDays(data.days ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load map data');
    } finally {
      setLoading(false);
    }
  }, [token, tripId]);

  const fetchTrip = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTimezone(data.trip?.timezone ?? null);
      }
    } catch {
      /* non-critical: times just render without a tz suffix */
    }
  }, [token, tripId]);

  useEffect(() => {
    fetchDays();
    fetchTrip();
  }, [fetchDays, fetchTrip]);

  // Keep pins in sync when collaborators change blocks while the map is open.
  // `onReconnect` also refetches after a dropped connection, since any block
  // events broadcast while we were offline are gone for good.
  const { socket } = useSocket({ tripId, token, onReconnect: fetchDays });
  useEffect(() => {
    if (!socket) return;
    const refetch = () => fetchDays();
    const events = ['block:created', 'block:updated', 'block:moved', 'block:deleted'];
    events.forEach((event) => socket.on(event, refetch));
    return () => events.forEach((event) => socket.off(event, refetch));
  }, [socket, fetchDays]);

  // ─── Derived map data ────────────────────────────────────────────────────

  const tzAbbrev = useMemo(() => timezoneAbbreviation(timezone), [timezone]);

  /** Every geo-located block across the trip, flattened into pins. */
  const allPins = useMemo(() => {
    const blocks: BlockLike[] = days.flatMap((day) =>
      day.blocks.map((block) => ({
        id: block.id,
        title: block.title,
        category: block.category,
        latitude: block.latitude,
        longitude: block.longitude,
        startTime: block.startTime,
        endTime: block.endTime,
        dayNumber: day.dayNumber,
      }))
    );
    return toMapPins(blocks);
  }, [days]);

  const totalBlocks = useMemo(
    () => days.reduce((sum, day) => sum + day.blocks.length, 0),
    [days]
  );
  const missingLocationCount = totalBlocks - allPins.length;

  /**
   * Colors are keyed by the highest day number rather than the day count, so
   * every day still gets a color if the numbering has gaps.
   */
  const dayColors = useMemo(
    () => assignDayColors(days.reduce((max, day) => Math.max(max, day.dayNumber), 0)),
    [days]
  );

  /** Only days that actually have pins get a filter row. */
  const filterEntries = useMemo<DayFilterEntry[]>(() => {
    const byDay = groupPinsByDay(allPins);
    return [...byDay.entries()].map(([dayNumber, dayPins]) => ({
      dayNumber,
      color: dayColors.get(dayNumber) ?? '#c13a28', // fallback = --color-primary
      pinCount: dayPins.length,
    }));
  }, [allPins, dayColors]);

  const visibleDays = useMemo(
    () => new Set(filterEntries.map((d) => d.dayNumber).filter((n) => !hiddenDays.has(n))),
    [filterEntries, hiddenDays]
  );

  const visiblePins = useMemo(
    () => allPins.filter((pin) => visibleDays.has(pin.dayNumber)),
    [allPins, visibleDays]
  );

  /** Routes are built from the visible pins so hidden days drop their lines. */
  const routes = useMemo(
    () => withEstimatedDistances(buildRouteSegments(visiblePins)),
    [visiblePins]
  );

  /**
   * Resolved from the pin list rather than stored directly, so the selection
   * survives (or clears) correctly when blocks change under real-time updates.
   */
  const selectedPin = useMemo<MapPin | null>(
    () => visiblePins.find((pin) => pin.blockId === selectedBlockId) ?? null,
    [visiblePins, selectedBlockId]
  );

  const handlePinClick = useCallback(
    (pin: MapPin) => {
      setSelectedBlockId((prev) => {
        // Selecting a different pin invalidates the previous nearby results.
        if (prev !== pin.blockId) clearNearby();
        return pin.blockId;
      });
    },
    [clearNearby]
  );

  // ─── Nearby search ─────────────────────────────────────────────────────────

  /** Day id that owns the selected pin, used as the target for added POIs. */
  const selectedDayId = useMemo(
    () =>
      selectedBlockId
        ? days.find((day) => day.blocks.some((b) => b.id === selectedBlockId))?.id ?? null
        : null,
    [days, selectedBlockId]
  );

  /** Category bar click: search the chosen category around the selected pin. */
  const handleCategorySearch = useCallback(
    (category: string) => {
      if (!selectedPin) return;
      runNearbySearch({
        latitude: selectedPin.latitude,
        longitude: selectedPin.longitude,
        category,
        radius: NEARBY_RADIUS_M,
      });
    },
    [selectedPin, runNearbySearch]
  );

  /** Pin popup "What's nearby?": select the pin and search around it. */
  const handleWhatsNearby = useCallback(
    (pin: MapPin) => {
      setSelectedBlockId(pin.blockId);
      runNearbySearch({
        latitude: pin.latitude,
        longitude: pin.longitude,
        // Reuse the active category so the button feels consistent; default to cafes.
        category: nearbyCategory ?? NEARBY_CATEGORIES[0].key,
        radius: NEARBY_RADIUS_M,
      });
    },
    [runNearbySearch, nearbyCategory]
  );

  /** Emits a socket block:create, reusing the same flow as the itinerary board. */
  const createBlock = useCallback(
    (input: {
      dayId: string;
      title: string;
      category: string;
      latitude?: number;
      longitude?: number;
      locationName?: string;
    }): Promise<{ ok: boolean; error?: string }> =>
      new Promise((resolve) => {
        if (!socket || !socket.connected) {
          resolve({ ok: false, error: 'Not connected' });
          return;
        }
        socket.emit('block:create', input, (res: { ok?: boolean; error?: string; message?: string }) => {
          if (res?.ok) resolve({ ok: true });
          else resolve({ ok: false, error: res?.message || res?.error || 'Failed to add activity' });
        });
      }),
    [socket]
  );

  /** Leg leaving the selected pin, for the "next stop" distance readout. */
  const selectedLeg = useMemo(
    () => (selectedPin ? routes.find((s) => s.from.blockId === selectedPin.blockId) ?? null : null),
    [routes, selectedPin]
  );

  /** Straight-line distance walked per visible day, for the side summary. */
  const dayDistances = useMemo(() => {
    const totals = new Map<number, number>();
    for (const segment of routes) {
      const day = segment.from.dayNumber;
      totals.set(day, (totals.get(day) ?? 0) + (segment.distance ?? 0));
    }
    return totals;
  }, [routes]);

  // ─── Filter handlers ─────────────────────────────────────────────────────

  const toggleDay = useCallback((dayNumber: number) => {
    setHiddenDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayNumber)) next.delete(dayNumber);
      else next.add(dayNumber);
      return next;
    });
  }, []);

  const showAllDays = useCallback(() => setHiddenDays(new Set()), []);
  const hideAllDays = useCallback(
    () => setHiddenDays(new Set(filterEntries.map((d) => d.dayNumber))),
    [filterEntries]
  );

  const itineraryHref = useCallback(
    (blockId: string) => `/trip/${tripId}?block=${blockId}`,
    [tripId]
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  if (error) {
    return <div className="rounded-lg bg-danger-tint p-4 text-sm text-danger">{error}</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-4">
        {loading ? (
          <div aria-busy="true" aria-label="Loading map" className="space-y-4">
            <div className="h-40 animate-pulse rounded-2xl border border-border bg-card" />
            <div className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
          </div>
        ) : (
        <>
        <DayFilter
          days={filterEntries}
          visibleDays={visibleDays}
          onToggleDay={toggleDay}
          onShowAll={showAllDays}
          onShowNone={hideAllDays}
        />

        {selectedPin && (
          <div className="rounded-2xl border border-primary bg-primary-tint/60 p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{selectedPin.title}</h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedBlockId(null);
                  clearNearby();
                }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Day {selectedPin.dayNumber}
              {selectedPin.startTime ? ` · ${formatTime(selectedPin.startTime, tzAbbrev)}` : ''} ·{' '}
              <span className="capitalize">{selectedPin.category}</span>
            </p>
            {selectedLeg && (
              <p className="mt-1 text-xs text-muted-foreground">
                ~{formatDistance(selectedLeg.distance)}
                {selectedLeg.duration ? ` · ${formatDuration(selectedLeg.duration)}` : ''} to{' '}
                {selectedLeg.to.title}
              </p>
            )}

            {/* Nearby-places category bar — searches around this pin. */}
            <div className="mt-3 border-t border-primary/20 pt-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Explore nearby</p>
              <div className="flex flex-wrap gap-1.5">
                {NEARBY_CATEGORIES.map((cat) => {
                  const active = nearbyCategory === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => handleCategorySearch(cat.key)}
                      disabled={nearbyLoading}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                        active
                          ? 'bg-primary text-white'
                          : 'bg-card text-foreground hover:bg-muted border border-border'
                      }`}
                    >
                      <span aria-hidden="true">{cat.emoji}</span>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
              {nearbyLoading && (
                <p className="mt-2 text-xs text-muted-foreground">Finding nearby places…</p>
              )}
              {nearbyError && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {nearbyError}
                </p>
              )}
              {!nearbyLoading && !nearbyError && nearbySearched && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {nearbyResults.length > 0
                    ? `${nearbyResults.length} ${nearbyCategory ?? ''} place${
                        nearbyResults.length === 1 ? '' : 's'
                      } within ${NEARBY_RADIUS_M} m — tap a pin to add it.`
                    : `No ${nearbyCategory ?? ''} places found within ${NEARBY_RADIUS_M} m.`}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Route estimate</h3>
          {dayDistances.size === 0 ? (
            <p className="text-xs text-muted-foreground">
              Add two or more located activities in a day to see route distances.
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {[...dayDistances.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([dayNumber, meters]) => (
                  <li key={dayNumber} className="flex items-center justify-between">
                    <span>Day {dayNumber}</span>
                    <span className="stat-number text-foreground">~{formatDistance(meters)}</span>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Straight-line (haversine) estimates, not driving directions.
          </p>
        </div>

        {missingLocationCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {missingLocationCount} {missingLocationCount === 1 ? 'activity has' : 'activities have'}{' '}
            no location yet, so {missingLocationCount === 1 ? 'it is' : 'they are'} not on the map.
          </p>
        )}
        </>
        )}
      </aside>

      <div className="relative h-[32rem] overflow-hidden rounded-2xl border border-border bg-card lg:h-[36rem]">
        {loading ? (
          <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
            Loading map…
          </div>
        ) : (
        <MapView
          pins={visiblePins}
          routes={routes}
          dayColors={dayColors}
          onPinClick={handlePinClick}
          selectedBlockId={selectedBlockId}
          itineraryHref={itineraryHref}
          tzAbbrev={tzAbbrev}
          nearbyResults={nearbyResults}
          nearbyOrigin={nearbyOrigin}
          nearbyLoading={nearbyLoading}
          onWhatsNearby={handleWhatsNearby}
          onAddNearby={setAddingNearby}
          autoFit
        />
        )}

        {!loading && allPins.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-card/70 p-6 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              No activities have coordinates yet. Add a location to an activity and its pin will
              show up here.
            </p>
          </div>
        )}
      </div>

      {/* Add-a-nearby-POI flow: prefilled AddActivityModal, reusing socket block:create. */}
      {addingNearby && token && (selectedDayId ?? days[0]?.id) && (
        <AddActivityModal
          mode="create"
          dayId={(selectedDayId ?? days[0]!.id) as string}
          tripId={tripId}
          token={token}
          initial={{
            title: addingNearby.name,
            category: activityCategoryFor(addingNearby.category),
            locationName: addingNearby.name,
            latitude: addingNearby.latitude,
            longitude: addingNearby.longitude,
          }}
          createBlock={createBlock}
          onClose={() => setAddingNearby(null)}
          onCreated={() => {
            setAddingNearby(null);
            // The server acks the sender but broadcasts only to others, so
            // refetch locally to show the new pin immediately.
            fetchDays();
          }}
        />
      )}
    </div>
  );
}

export default TripMap;
