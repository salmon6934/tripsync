import { Router, Request, Response } from 'express';

import { authenticate } from '../middleware/auth.js';
import { nearbyRateLimiter } from '../middleware/rate-limit.js';
import {
  searchNearby,
  isValidCategory,
  CATEGORY_PRESETS,
  NearbyUpstreamError,
  NEARBY_ATTRIBUTION,
  NEARBY_LIMITS,
} from '../services/nearby.service.js';

const router = Router();

// Authentication is required so this can't be used as an open Overpass proxy.
router.use(authenticate);
router.use(nearbyRateLimiter);

/**
 * GET /api/nearby?lat=..&lng=..&category=cafe&radius=500
 *
 * Finds named POIs of a preset category within `radius` meters of a point,
 * through the server-side Overpass proxy (throttled + Redis-cached).
 *
 * The search origin is a client-chosen point — typically a selected itinerary
 * pin — not the caller's live location.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid or missing "lat"' });
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid or missing "lng"' });
      return;
    }

    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (!isValidCategory(category)) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `Unknown category. Expected one of: ${Object.keys(CATEGORY_PRESETS).join(', ')}`,
      });
      return;
    }

    // Clamped again in the service; parsed here just to accept the query param.
    const parsedRadius = parseInt(req.query.radius as string, 10);
    const radius = Number.isFinite(parsedRadius) ? parsedRadius : NEARBY_LIMITS.DEFAULT_RADIUS;

    const results = await searchNearby(category, lat, lng, { radius });

    res.status(200).json({ results, category, attribution: NEARBY_ATTRIBUTION });
  } catch (error) {
    if (error instanceof NearbyUpstreamError) {
      console.error('Nearby upstream error:', error.message);
      res.status(error.status).json({
        code: 'NEARBY_UPSTREAM_ERROR',
        message: 'Nearby search is temporarily unavailable. Please try again.',
      });
      return;
    }
    // AbortSignal.timeout rejects with a TimeoutError DOMException.
    if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') {
      console.error('Nearby request timed out');
      res.status(504).json({
        code: 'NEARBY_TIMEOUT',
        message: 'Nearby search timed out. Please try again.',
      });
      return;
    }
    console.error('Nearby search error:', error);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
});

export default router;
