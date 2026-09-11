import { describe, it, expect } from 'vitest';
import {
  assignDayColors,
  isValidCoordinate,
  toMapPins,
  groupPinsByDay,
  buildRouteSegments,
  computePinsBounds,
  computePinsCenter,
  formatDistance,
  formatDuration,
  haversineDistanceMeters,
  withEstimatedDistances,
  type BlockLike,
  type MapPin,
} from './map-utils';

/** Builds a MapPin with sensible defaults for tests. */
function pin(overrides: Partial<MapPin> & Pick<MapPin, 'blockId' | 'dayNumber'>): MapPin {
  return {
    latitude: 35.68,
    longitude: 139.76,
    title: overrides.blockId,
    category: 'activity',
    startTime: null,
    ...overrides,
  };
}

/** Builds a BlockLike with sensible defaults for tests. */
function block(overrides: Partial<BlockLike> & Pick<BlockLike, 'id' | 'dayNumber'>): BlockLike {
  return {
    title: overrides.id,
    category: 'activity',
    latitude: 35.68,
    longitude: 139.76,
    startTime: null,
    ...overrides,
  };
}

const HEX = /^#[0-9a-f]{6}$/;

describe('assignDayColors', () => {
  it('returns one distinct color per day for a small trip', () => {
    const colors = assignDayColors(5);
    expect(colors.size).toBe(5);
    for (let day = 1; day <= 5; day++) {
      expect(colors.get(day)).toMatch(HEX);
    }
    const unique = new Set(colors.values());
    expect(unique.size).toBe(5);
  });

  it('generates distinct colors even beyond the fixed palette', () => {
    const colors = assignDayColors(20);
    expect(colors.size).toBe(20);
    const unique = new Set(colors.values());
    expect(unique.size).toBe(20);
    for (const value of colors.values()) {
      expect(value).toMatch(HEX);
    }
  });

  it('returns an empty map for non-positive or invalid day counts', () => {
    expect(assignDayColors(0).size).toBe(0);
    expect(assignDayColors(-3).size).toBe(0);
    expect(assignDayColors(Number.NaN).size).toBe(0);
  });

  it('is deterministic across calls', () => {
    expect([...assignDayColors(7)]).toEqual([...assignDayColors(7)]);
  });

  // Property-style check: for many trip sizes, colors are unique and keyed 1..N.
  it('property: colors are unique and cover 1..N for many sizes', () => {
    for (let n = 1; n <= 40; n++) {
      const colors = assignDayColors(n);
      expect(colors.size).toBe(n);
      expect(new Set(colors.values()).size).toBe(n);
      for (let day = 1; day <= n; day++) {
        expect(colors.get(day)).toMatch(HEX);
      }
    }
  });
});

describe('isValidCoordinate', () => {
  it('accepts finite in-range coordinates including the extremes', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(35.68, 139.76)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('rejects null coordinates', () => {
    expect(isValidCoordinate(null, 10)).toBe(false);
    expect(isValidCoordinate(10, null)).toBe(false);
    expect(isValidCoordinate(null, null)).toBe(false);
  });

  it('rejects NaN and infinite coordinates', () => {
    expect(isValidCoordinate(NaN, 10)).toBe(false);
    expect(isValidCoordinate(10, NaN)).toBe(false);
    expect(isValidCoordinate(Infinity, 10)).toBe(false);
    expect(isValidCoordinate(10, -Infinity)).toBe(false);
  });

  it('rejects out-of-range latitudes and longitudes', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
  });
});

describe('toMapPins', () => {
  it('keeps only blocks that have both coordinates', () => {
    const blocks: BlockLike[] = [
      block({ id: 'a', dayNumber: 1, latitude: 1, longitude: 2 }),
      block({ id: 'b', dayNumber: 1, latitude: null, longitude: 2 }),
      block({ id: 'c', dayNumber: 1, latitude: 1, longitude: null }),
      block({ id: 'd', dayNumber: 2, latitude: null, longitude: null }),
      block({ id: 'e', dayNumber: 2, latitude: NaN, longitude: 5 }),
    ];
    const pins = toMapPins(blocks);
    expect(pins.map((p) => p.blockId)).toEqual(['a']);
  });

  it('drops blocks with out-of-range or infinite coordinates', () => {
    const blocks: BlockLike[] = [
      block({ id: 'ok', dayNumber: 1, latitude: 12, longitude: 77 }),
      block({ id: 'lat-hi', dayNumber: 1, latitude: 999, longitude: 10 }),
      block({ id: 'lat-lo', dayNumber: 1, latitude: -100, longitude: 10 }),
      block({ id: 'lng-hi', dayNumber: 1, latitude: 10, longitude: 200 }),
      block({ id: 'inf', dayNumber: 1, latitude: Infinity, longitude: 10 }),
    ];
    const pins = toMapPins(blocks);
    expect(pins.map((p) => p.blockId)).toEqual(['ok']);
  });

  it('maps block fields onto the pin shape', () => {
    const pins = toMapPins([
      block({
        id: 'x',
        dayNumber: 3,
        title: 'Sushi',
        category: 'food',
        latitude: 10,
        longitude: 20,
        startTime: '12:30',
      }),
    ]);
    expect(pins[0]).toEqual({
      blockId: 'x',
      latitude: 10,
      longitude: 20,
      title: 'Sushi',
      category: 'food',
      dayNumber: 3,
      startTime: '12:30',
      endTime: null,
    });
  });

  it('carries the end time through when present', () => {
    const pins = toMapPins([
      block({ id: 'y', dayNumber: 1, startTime: '09:00', endTime: '10:30' }),
    ]);
    expect(pins[0].endTime).toBe('10:30');
  });
});

describe('groupPinsByDay', () => {
  it('groups pins by day and orders days ascending', () => {
    const grouped = groupPinsByDay([
      pin({ blockId: 'a', dayNumber: 2 }),
      pin({ blockId: 'b', dayNumber: 1 }),
      pin({ blockId: 'c', dayNumber: 2 }),
    ]);
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)!.map((p) => p.blockId)).toEqual(['b']);
    expect(grouped.get(2)!.map((p) => p.blockId)).toEqual(['a', 'c']);
  });

  it('orders pins within a day chronologically by start time', () => {
    const grouped = groupPinsByDay([
      pin({ blockId: 'late', dayNumber: 1, startTime: '18:00' }),
      pin({ blockId: 'early', dayNumber: 1, startTime: '08:00' }),
      pin({ blockId: 'noon', dayNumber: 1, startTime: '12:00' }),
    ]);
    expect(grouped.get(1)!.map((p) => p.blockId)).toEqual(['early', 'noon', 'late']);
  });

  it('places pins without a start time after timed pins', () => {
    const grouped = groupPinsByDay([
      pin({ blockId: 'untimed', dayNumber: 1, startTime: null }),
      pin({ blockId: 'timed', dayNumber: 1, startTime: '09:00' }),
    ]);
    expect(grouped.get(1)!.map((p) => p.blockId)).toEqual(['timed', 'untimed']);
  });

  it('returns an empty map for no pins', () => {
    expect(groupPinsByDay([]).size).toBe(0);
  });
});

describe('buildRouteSegments', () => {
  it('connects consecutive pins within a day in time order', () => {
    const segments = buildRouteSegments([
      pin({ blockId: 'c', dayNumber: 1, startTime: '15:00' }),
      pin({ blockId: 'a', dayNumber: 1, startTime: '09:00' }),
      pin({ blockId: 'b', dayNumber: 1, startTime: '12:00' }),
    ]);
    expect(segments.map((s) => [s.from.blockId, s.to.blockId])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(segments.every((s) => s.distance === null && s.duration === null)).toBe(true);
  });

  it('does not connect pins across different days', () => {
    const segments = buildRouteSegments([
      pin({ blockId: 'd1a', dayNumber: 1, startTime: '09:00' }),
      pin({ blockId: 'd1b', dayNumber: 1, startTime: '10:00' }),
      pin({ blockId: 'd2a', dayNumber: 2, startTime: '09:00' }),
      pin({ blockId: 'd2b', dayNumber: 2, startTime: '10:00' }),
    ]);
    expect(segments.map((s) => [s.from.blockId, s.to.blockId])).toEqual([
      ['d1a', 'd1b'],
      ['d2a', 'd2b'],
    ]);
  });

  it('produces no segments for a day with a single pin', () => {
    expect(buildRouteSegments([pin({ blockId: 'solo', dayNumber: 1 })])).toEqual([]);
  });

  it('produces N-1 segments per day', () => {
    const pins = [1, 2, 3, 4].map((i) =>
      pin({ blockId: `p${i}`, dayNumber: 1, startTime: `0${i}:00` })
    );
    expect(buildRouteSegments(pins)).toHaveLength(3);
  });
});

describe('computePinsCenter', () => {
  it('averages coordinates of the pins', () => {
    const center = computePinsCenter([
      pin({ blockId: 'a', dayNumber: 1, latitude: 0, longitude: 0 }),
      pin({ blockId: 'b', dayNumber: 1, latitude: 10, longitude: 20 }),
    ]);
    expect(center).toEqual([5, 10]);
  });

  it('returns null when there are no pins', () => {
    expect(computePinsCenter([])).toBeNull();
  });
});

describe('haversineDistanceMeters', () => {
  it('returns zero for identical coordinates', () => {
    const p = { latitude: 35.68, longitude: 139.76 };
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it('matches a known distance (Tokyo Station → Tokyo Tower ≈ 4.0 km)', () => {
    const meters = haversineDistanceMeters(
      { latitude: 35.6812, longitude: 139.7671 },
      { latitude: 35.6586, longitude: 139.7454 }
    );
    // Great-circle distance is ~3.2 km; allow a generous tolerance.
    expect(meters).toBeGreaterThan(3000);
    expect(meters).toBeLessThan(3500);
  });

  it('is symmetric', () => {
    const a = { latitude: 12.97, longitude: 77.59 };
    const b = { latitude: 19.08, longitude: 72.88 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('approximates one degree of latitude as ~111 km anywhere on the globe', () => {
    for (const lat of [-60, -30, 0, 30, 60]) {
      const meters = haversineDistanceMeters(
        { latitude: lat, longitude: 0 },
        { latitude: lat + 1, longitude: 0 }
      );
      expect(meters).toBeGreaterThan(110_000);
      expect(meters).toBeLessThan(112_000);
    }
  });
});

describe('withEstimatedDistances', () => {
  it('fills in distance and duration on unenriched segments', () => {
    const segments = buildRouteSegments([
      pin({ blockId: 'a', dayNumber: 1, startTime: '09:00', latitude: 0, longitude: 0 }),
      pin({ blockId: 'b', dayNumber: 1, startTime: '10:00', latitude: 0, longitude: 1 }),
    ]);
    const [segment] = withEstimatedDistances(segments);
    expect(segment.distance).toBeGreaterThan(110_000);
    expect(segment.duration).toBeGreaterThan(0);
  });

  it('leaves segments that already have a distance untouched', () => {
    const [from, to] = [
      pin({ blockId: 'a', dayNumber: 1, latitude: 0, longitude: 0 }),
      pin({ blockId: 'b', dayNumber: 1, latitude: 0, longitude: 1 }),
    ];
    const enriched = withEstimatedDistances([{ from, to, distance: 1234, duration: 60 }]);
    expect(enriched[0]).toEqual({ from, to, distance: 1234, duration: 60 });
  });

  it('returns an empty list for no segments', () => {
    expect(withEstimatedDistances([])).toEqual([]);
  });
});

describe('formatDistance', () => {
  it('uses meters below 1 km and kilometers above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1200)).toBe('1.2 km');
    expect(formatDistance(18_400)).toBe('18 km');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatDistance(null)).toBe('');
    expect(formatDistance(Number.NaN)).toBe('');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(4800)).toBe('1 h 20 min');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});

describe('computePinsBounds', () => {
  it('encloses all pins as [[south, west], [north, east]]', () => {
    const bounds = computePinsBounds([
      pin({ blockId: 'a', dayNumber: 1, latitude: 10, longitude: -5 }),
      pin({ blockId: 'b', dayNumber: 1, latitude: -3, longitude: 40 }),
      pin({ blockId: 'c', dayNumber: 2, latitude: 22, longitude: 12 }),
    ]);
    expect(bounds).toEqual([
      [-3, -5],
      [22, 40],
    ]);
  });

  it('returns a degenerate box for a single pin', () => {
    expect(computePinsBounds([pin({ blockId: 'solo', dayNumber: 1, latitude: 1, longitude: 2 })])).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it('returns null when there are no pins', () => {
    expect(computePinsBounds([])).toBeNull();
  });

  // Property-style check: every pin must fall inside the computed box.
  it('property: all pins fall within the returned bounds', () => {
    const pins = Array.from({ length: 25 }, (_, i) =>
      pin({
        blockId: `p${i}`,
        dayNumber: (i % 4) + 1,
        latitude: ((i * 7) % 170) - 85,
        longitude: ((i * 23) % 350) - 175,
      })
    );
    const bounds = computePinsBounds(pins)!;
    const [[south, west], [north, east]] = bounds;
    for (const p of pins) {
      expect(p.latitude).toBeGreaterThanOrEqual(south);
      expect(p.latitude).toBeLessThanOrEqual(north);
      expect(p.longitude).toBeGreaterThanOrEqual(west);
      expect(p.longitude).toBeLessThanOrEqual(east);
    }
  });
});
