'use client';

/**
 * Leaflet-backed map that renders itinerary pins colored by day, draws
 * chronological route lines within each day, and shows block details in a
 * popup on pin click.
 *
 * NOTE: Leaflet touches `window` at import time, so this component must only be
 * rendered on the client. Import it through `@/components/map` (which wraps it
 * in a `dynamic(..., { ssr: false })` boundary) rather than importing this file
 * directly from a server component.
 */

import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import 'leaflet/dist/leaflet.css';
import { Bed, MapPinned, Navigation2, Utensils, type LucideIcon } from 'lucide-react';
import type { ActivityCategory } from '@tripsync/shared';
import type { MapPin, RouteSegment } from '@/lib/map-utils';
import {
  computePinsBounds,
  computePinsCenter,
  formatDistance,
  formatDuration,
  groupPinsByDay,
} from '@/lib/map-utils';
import { formatTime } from '@/lib/format';
import { createDayIcon } from './dayMarkerIcon';

export type { MapPin, RouteSegment } from '@/lib/map-utils';

export interface MapViewProps {
  pins: MapPin[];
  routes: RouteSegment[];
  /** Map of dayNumber -> "#rrggbb" hex color. */
  dayColors: Map<number, string>;
  /**
   * Called with the clicked pin. The full pin (not just its id) is passed so
   * consumers can act on its coordinates — e.g. a nearby-places search.
   */
  onPinClick?: (pin: MapPin) => void;
  /** Block whose pin is currently selected — rendered with a darker ring. */
  selectedBlockId?: string | null;
  /** Builds the href for the popup's "Go to Itinerary" link. */
  itineraryHref?: (blockId: string) => string;
  /**
   * Initial center [lat, lng], typically the trip destination. When omitted,
   * the center is derived from the pins, falling back to a world view.
   */
  center?: [number, number];
  /** Initial zoom level. Defaults to 13 (city-level). */
  zoom?: number;
  /** Auto-fit the viewport to all pins whenever the pin set changes. */
  autoFit?: boolean;
  /** Timezone abbreviation appended to popup times, e.g. "JST". */
  tzAbbrev?: string | null;
  className?: string;
}

/** Fallback center when there are neither pins nor a destination (mid-world). */
const DEFAULT_CENTER: [number, number] = [20, 0];

/**
 * Basemap tile source. Defaults to the keyless OpenStreetMap standard tiles,
 * which render without watermarks and require no API key.
 *
 * CARTO's "Voyager" basemap (previously used here for its warmer palette) now
 * stamps unkeyed tiles with an "API KEY REQUIRED" watermark, so it can't be
 * used anonymously anymore. To restore a warmer style, provide a keyed URL via
 * `NEXT_PUBLIC_MAP_TILE_URL` (and optional `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` /
 * `NEXT_PUBLIC_MAP_TILE_SUBDOMAINS`) — e.g. a MapTiler or Stadia style that
 * embeds your key in the URL.
 */
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE_SUBDOMAINS = process.env.NEXT_PUBLIC_MAP_TILE_SUBDOMAINS ?? 'abc';
const DEFAULT_ZOOM = 13;
const FALLBACK_COLOR = '#c13a28'; // --color-primary
/** Keeps `fitBounds` from zooming all the way in on a single pin. */
const MAX_FIT_ZOOM = 15;

const CATEGORY_ICONS: Record<ActivityCategory, LucideIcon> = {
  food: Utensils,
  travel: Navigation2,
  stay: Bed,
  activity: MapPinned,
};

/** Renders the lucide category icon (secondary theme color) for a map pin. */
function CategoryIcon({ category }: { category: ActivityCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />;
}

/**
 * Keeps the Leaflet view in sync when the resolved center changes (e.g. after
 * the destination geocodes or pins load in). Skipped while auto-fit is driving
 * the viewport.
 */
function RecenterOnChange({
  center,
  zoom,
  enabled,
}: {
  center: [number, number];
  zoom: number;
  enabled: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    map.setView(center, zoom);
  }, [map, center[0], center[1], zoom, enabled]);
  return null;
}

/**
 * Fits the viewport to all pins when the pin set changes, so newly loaded or
 * filtered data is always fully visible. The pin signature (ids + coordinates)
 * is the dependency, which avoids refitting on unrelated re-renders and lets
 * the user pan/zoom freely in between.
 */
function FitToPins({ pins, enabled }: { pins: MapPin[]; enabled: boolean }) {
  const map = useMap();
  const signature = pins
    .map((p) => `${p.blockId}:${p.latitude},${p.longitude}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!enabled || pins.length === 0) return;
    const bounds = computePinsBounds(pins);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM });
    // Depends on `signature` rather than `pins`: it captures the meaningful pin
    // changes, while the `pins` array identity churns on every render.
  }, [map, signature, enabled]);

  return null;
}

/** "9:00 AM – 11:30 AM", "9:00 AM", or "Unscheduled". */
function formatTimeSlot(pin: MapPin, tzAbbrev?: string | null): string {
  if (!pin.startTime) return 'Unscheduled';
  const start = formatTime(pin.startTime, pin.endTime ? null : tzAbbrev);
  if (!pin.endTime) return start;
  return `${start} – ${formatTime(pin.endTime, tzAbbrev)}`;
}

export function MapView({
  pins,
  routes,
  dayColors,
  onPinClick,
  selectedBlockId,
  itineraryHref,
  center,
  zoom = DEFAULT_ZOOM,
  autoFit = true,
  tzAbbrev,
  className,
}: MapViewProps) {
  const resolvedCenter = center ?? computePinsCenter(pins) ?? DEFAULT_CENTER;
  const hasFocus = center != null || pins.length > 0;
  const resolvedZoom = hasFocus ? zoom : 2;
  const fitEnabled = autoFit && pins.length > 0;

  /** blockId -> 1-based stop order within its day, for the pin labels. */
  const stopOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const dayPins of groupPinsByDay(pins).values()) {
      dayPins.forEach((pin, index) => order.set(pin.blockId, index + 1));
    }
    return order;
  }, [pins]);

  return (
    <MapContainer
      center={resolvedCenter}
      zoom={resolvedZoom}
      scrollWheelZoom
      className={className ?? 'h-full w-full'}
      style={className ? undefined : { height: '100%', width: '100%' }}
    >
      {/* `hasFocus` keeps the view put when every day is filtered out, instead
          of snapping back to the world view. */}
      <RecenterOnChange
        center={resolvedCenter}
        zoom={resolvedZoom}
        enabled={!fitEnabled && hasFocus}
      />
      <FitToPins pins={pins} enabled={fitEnabled} />

      {/*
        Basemap tiles. Defaults to keyless OpenStreetMap standard tiles; a
        warmer keyed style can be supplied via NEXT_PUBLIC_MAP_TILE_URL. See the
        TILE_URL constant above for details.
      */}
      <TileLayer
        attribution={TILE_ATTRIBUTION}
        url={TILE_URL}
        subdomains={TILE_SUBDOMAINS}
      />

      {routes.map((segment) => {
        const color = dayColors.get(segment.from.dayNumber) ?? FALLBACK_COLOR;
        const distance = formatDistance(segment.distance);
        const duration = formatDuration(segment.duration);
        return (
          <Polyline
            key={`route-${segment.from.blockId}-${segment.to.blockId}`}
            positions={[
              [segment.from.latitude, segment.from.longitude],
              [segment.to.latitude, segment.to.longitude],
            ]}
            pathOptions={{ color, weight: 4, opacity: 0.85 }}
          >
            {distance && (
              <Tooltip sticky>
                <span className="text-xs">
                  ~{distance}
                  {duration ? ` · ${duration}` : ''}
                  <span className="text-muted-foreground"> (straight line)</span>
                </span>
              </Tooltip>
            )}
          </Polyline>
        );
      })}

      {pins.map((pin) => {
        const color = dayColors.get(pin.dayNumber) ?? FALLBACK_COLOR;
        const icon = createDayIcon(color, {
          label: stopOrder.get(pin.blockId),
          selected: selectedBlockId === pin.blockId,
        });
        return (
          <Marker
            key={`pin-${pin.blockId}`}
            position={[pin.latitude, pin.longitude]}
            icon={icon}
            eventHandlers={{ click: () => onPinClick?.(pin) }}
          >
            <Popup>
              <div className="min-w-[180px] text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <CategoryIcon category={pin.category} />
                  {pin.title}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  Day {pin.dayNumber} · {formatTimeSlot(pin, tzAbbrev)}
                </p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">{pin.category}</p>
                {itineraryHref && (
                  <Link
                    href={itineraryHref(pin.blockId)}
                    className="mt-2 inline-block text-xs font-medium text-primary hover:text-primary-tint-foreground"
                  >
                    Go to Itinerary →
                  </Link>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

export default MapView;
