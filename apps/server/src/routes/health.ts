import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getRedisClient } from '../services/presence.service.js';

export const healthRouter = Router();

/**
 * GET /api/health
 * Basic liveness check.
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/ready
 * Readiness check for database (Postgres) and cache (Redis).
 * Used by cold-start warm-up logic on the frontend to detect when free-tier
 * backend compute and datastores have finished waking up.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  let dbReady = false;
  let redisReady = false;

  try {
    await db.execute(sql`SELECT 1`);
    dbReady = true;
  } catch (err) {
    console.error('Readiness probe DB error:', err);
  }

  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    if (pong === 'PONG') {
      redisReady = true;
    }
  } catch (err) {
    console.error('Readiness probe Redis error:', err);
  }

  const isReady = dbReady && redisReady;
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    db: dbReady,
    redis: redisReady,
    ready: isReady,
    timestamp: new Date().toISOString(),
  });
});
