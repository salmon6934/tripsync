/**
 * Builds Leaflet marker icons for itinerary pins, colored per trip day.
 *
 * Leaflet's default marker is a static PNG, so day coloring is done with a
 * `divIcon` containing an inline SVG teardrop. Icons are cached by
 * color+label+state because Leaflet recreates the DOM node for every icon
 * instance and map re-renders are frequent.
 *
 * NOTE: imports `leaflet`, so this module is client-only.
 */

import L from 'leaflet';

/** Marker footprint in px. The tip sits at the bottom-center of the box. */
const ICON_WIDTH = 26;
const ICON_HEIGHT = 36;

const iconCache = new Map<string, L.DivIcon>();

export interface DayMarkerOptions {
  /** Short label rendered inside the pin, e.g. the stop order within the day. */
  label?: string | number;
  /** Renders a thicker ring to indicate the pin is selected. */
  selected?: boolean;
}

/**
 * Returns a teardrop marker icon filled with `color`.
 *
 * @param color "#rrggbb" fill color, typically from `assignDayColors`
 */
export function createDayIcon(color: string, options: DayMarkerOptions = {}): L.DivIcon {
  const label = options.label == null ? '' : String(options.label);
  const selected = options.selected ?? false;
  const cacheKey = `${color}|${label}|${selected ? 's' : ''}`;

  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const stroke = selected ? '#2b2620' : '#ffffff'; // selected = --color-foreground
  const strokeWidth = selected ? 2.5 : 1.5;

  // Teardrop outline: circular head with a point at the bottom center.
  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${ICON_WIDTH}" height="${ICON_HEIGHT}" viewBox="0 0 26 36" aria-hidden="true">
      <path
        d="M13 35C13 35 24.5 21.4 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 21.4 13 35 13 35Z"
        fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      ${
        label
          ? `<text x="13" y="17" text-anchor="middle" font-size="11" font-weight="700"
               font-family="ui-sans-serif, system-ui, sans-serif" fill="#ffffff">${escapeHtml(label)}</text>`
          : `<circle cx="13" cy="13" r="4" fill="#ffffff" fill-opacity="0.9" />`
      }
    </svg>
  `;

  const icon = L.divIcon({
    html,
    // Empty className drops Leaflet's default white box/border on div icons.
    className: 'trip-map-pin',
    iconSize: [ICON_WIDTH, ICON_HEIGHT],
    iconAnchor: [ICON_WIDTH / 2, ICON_HEIGHT],
    popupAnchor: [0, -ICON_HEIGHT + 4],
    tooltipAnchor: [ICON_WIDTH / 2, -ICON_HEIGHT / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
}

/** Nearby-POI marker footprint in px. Smaller circle, visually distinct from itinerary teardrops. */
const NEARBY_ICON_SIZE = 22;

let nearbyIcon: L.DivIcon | null = null;

/**
 * Returns the shared marker icon for temporary "nearby places" results.
 *
 * Deliberately styled unlike the day-colored itinerary teardrops: a small
 * dashed circle in a neutral violet so users can tell exploratory POIs apart
 * from activities already on their plan at a glance. A single cached instance
 * is reused for every nearby pin.
 */
export function createNearbyIcon(): L.DivIcon {
  if (nearbyIcon) return nearbyIcon;

  const fill = '#7c5cbf'; // muted violet — not in the day palette
  const size = NEARBY_ICON_SIZE;
  const r = size / 2 - 2;
  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="${fill}" fill-opacity="0.9" stroke="#ffffff" stroke-width="2"
        stroke-dasharray="3 2" />
      <circle cx="${size / 2}" cy="${size / 2}" r="2.5" fill="#ffffff" />
    </svg>
  `;

  nearbyIcon = L.divIcon({
    html,
    className: 'trip-map-nearby-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    tooltipAnchor: [size / 2, -size / 2],
  });
  return nearbyIcon;
}

/** Escapes the few characters that could break out of SVG text content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
