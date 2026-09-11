'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * On-demand "nearby places" lookup against the server's Overpass proxy
 * (`GET /api/nearby`).
 *
 * Unlike geocoding autocomplete this is not debounced — a search is fired
 * explicitly (a category click, or a pin's "What's nearby?" action) rather than
 * on every keystroke. The browser never calls Overpass directly: its usage
 * policy requires an identifying User-Agent and rate limiting, both enforced
 * server-side. See `apps/server/src/services/nearby.service.ts`.
 */

export interface NearbyResult {
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  tags: Record<string, string>;
}

/** Origin point a set of results was searched around, for distance readouts. */
export interface NearbyOrigin {
  latitude: number;
  longitude: number;
}

interface SearchArgs {
  latitude: number;
  longitude: number;
  category: string;
  radius?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function useNearbySearch(token: string | undefined) {
  const [results, setResults] = useState<NearbyResult[]>([]);
  const [origin, setOrigin] = useState<NearbyOrigin | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** True once a search has completed, so callers can tell "no matches" from "not searched". */
  const [searched, setSearched] = useState(false);

  // Aborts an in-flight request when a newer search supersedes it.
  const controllerRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async ({ latitude, longitude, category: cat, radius }: SearchArgs) => {
      if (!token) {
        setError('Not authenticated');
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);
      setError('');
      setSearched(false);
      setCategory(cat);
      setOrigin({ latitude, longitude });

      try {
        const params = new URLSearchParams({
          lat: String(latitude),
          lng: String(longitude),
          category: cat,
        });
        if (radius != null) params.set('radius', String(radius));

        const res = await fetch(`${API_URL}/api/nearby?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Nearby search failed');
        }

        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setSearched(true);
      } catch (err) {
        // A newer search aborted this one; that run now owns the state.
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Nearby search failed');
        setResults([]);
        setSearched(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [token]
  );

  /** Clears results and any in-flight request — e.g. when the selection changes. */
  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setResults([]);
    setOrigin(null);
    setCategory(null);
    setError('');
    setSearched(false);
    setLoading(false);
  }, []);

  return { results, origin, category, loading, error, searched, search, clear };
}
