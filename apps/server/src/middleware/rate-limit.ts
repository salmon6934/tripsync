import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for auth routes: 10 requests per 15 minutes per IP.
 * Prevents brute-force login/signup attempts.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
});

/**
 * General API rate limiter: 120 requests per minute per IP.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later',
  },
});

/**
 * Geocoding proxy rate limiter: 40 requests per minute per IP.
 *
 * Tighter than the general API limiter because each miss can cost an upstream
 * Nominatim call, and their usage policy caps us at ~1 req/sec overall. The
 * client debounces and results are cached, so a real user stays well under this.
 */
export const geocodeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many location searches, please slow down',
  },
});

/**
 * Nearby-places (Overpass) proxy rate limiter: 30 requests per minute per IP.
 *
 * Tighter than the general API limiter because each miss can cost a slow,
 * rate-limited Overpass call. Results are cached and searches are user-driven
 * (a category click), so a real user stays well under this.
 */
export const nearbyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many nearby searches, please slow down',
  },
});

/**
 * Socket.io event rate limiter for block mutations.
 * Tracks per-user event counts in a simple in-memory map.
 * Throttle: 30 mutations per minute per user.
 */
const socketEventCounts = new Map<string, { count: number; resetAt: number }>();

export function checkSocketRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = socketEventCounts.get(userId);

  if (!entry || now > entry.resetAt) {
    // New window
    socketEventCounts.set(userId, { count: 1, resetAt: now + 60 * 1000 });
    return true;
  }

  if (entry.count >= 30) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of socketEventCounts.entries()) {
    if (now > entry.resetAt) {
      socketEventCounts.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
