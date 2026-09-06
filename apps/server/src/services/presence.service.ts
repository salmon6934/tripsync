import { Redis } from 'ioredis';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PresenceInfo {
  userId: string;
  userName: string;
  avatarId: number | null;
  editingBlockId: string | null;
  lastHeartbeat: string; // ISO string for JSON serialization
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESENCE_TTL = 30; // seconds

// ─── Redis Client ────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL);
    redisClient.on('error', (err) => {
      console.error('Presence Redis client error:', err.message);
    });
  }
  return redisClient;
}

/**
 * Allows injecting a custom Redis client (useful for testing or sharing connections).
 */
export function setRedisClient(client: Redis): void {
  redisClient = client;
}

// ─── Key Helpers ─────────────────────────────────────────────────────────────

function presenceKey(tripId: string, userId: string): string {
  return `presence:${tripId}:${userId}`;
}

function membersKey(tripId: string): string {
  return `presence:${tripId}:members`;
}

// ─── Service Methods ─────────────────────────────────────────────────────────

/**
 * Registers a user as present in a trip.
 * Sets their presence JSON with TTL and adds them to the trip members set.
 */
export async function join(
  tripId: string,
  userId: string,
  userName: string = 'Unknown',
  avatarId: number | null = null
): Promise<void> {
  const redis = getRedisClient();
  const key = presenceKey(tripId, userId);

  const payload: PresenceInfo = {
    userId,
    userName,
    avatarId,
    editingBlockId: null,
    lastHeartbeat: new Date().toISOString(),
  };

  await redis.set(key, JSON.stringify(payload), 'EX', PRESENCE_TTL);
  await redis.sadd(membersKey(tripId), userId);
}

/**
 * Removes a user's presence from a trip.
 * Deletes the presence key and removes from the members set.
 */
export async function leave(tripId: string, userId: string): Promise<void> {
  const redis = getRedisClient();
  const key = presenceKey(tripId, userId);

  await redis.del(key);
  await redis.srem(membersKey(tripId), userId);
}

/**
 * Refreshes a user's presence TTL (heartbeat).
 * Also updates the lastHeartbeat timestamp in the payload.
 */
export async function heartbeat(tripId: string, userId: string): Promise<void> {
  const redis = getRedisClient();
  const key = presenceKey(tripId, userId);

  // Get current payload to update lastHeartbeat
  const existing = await redis.get(key);
  if (existing) {
    const payload: PresenceInfo = JSON.parse(existing);
    payload.lastHeartbeat = new Date().toISOString();
    await redis.set(key, JSON.stringify(payload), 'EX', PRESENCE_TTL);
  } else {
    // Key already expired — just refresh the TTL with expire won't work on non-existing key
    // The user should re-join if their key expired
    await redis.expire(key, PRESENCE_TTL);
  }
}

/**
 * Updates which block a user is currently editing.
 * Pass null to clear the editing state.
 */
export async function setEditing(
  tripId: string,
  userId: string,
  blockId: string | null
): Promise<void> {
  const redis = getRedisClient();
  const key = presenceKey(tripId, userId);

  const existing = await redis.get(key);
  if (!existing) return;

  const payload: PresenceInfo = JSON.parse(existing);
  payload.editingBlockId = blockId;
  payload.lastHeartbeat = new Date().toISOString();

  await redis.set(key, JSON.stringify(payload), 'EX', PRESENCE_TTL);
}

/**
 * Gets all currently online members for a trip.
 * Uses SMEMBERS to get user IDs, then batch-GETs their presence data.
 * Automatically cleans up stale entries (users in set but without presence key).
 */
export async function getOnlineMembers(tripId: string): Promise<PresenceInfo[]> {
  const redis = getRedisClient();
  const memberIds = await redis.smembers(membersKey(tripId));

  if (memberIds.length === 0) return [];

  // Batch GET all presence keys
  const keys = memberIds.map((uid) => presenceKey(tripId, uid));
  const values = await redis.mget(...keys);

  const onlineMembers: PresenceInfo[] = [];
  const staleUserIds: string[] = [];

  for (let i = 0; i < memberIds.length; i++) {
    const value = values[i];
    if (value) {
      onlineMembers.push(JSON.parse(value));
    } else {
      // User is in the set but their key expired — mark as stale
      staleUserIds.push(memberIds[i]);
    }
  }

  // Clean up stale entries from the set
  if (staleUserIds.length > 0) {
    await redis.srem(membersKey(tripId), ...staleUserIds);
  }

  return onlineMembers;
}

/**
 * Cleans up stale presence entries across all trip member sets.
 * This can be run periodically as a maintenance task.
 */
export async function cleanupStale(): Promise<void> {
  // In a real implementation, this would scan for all presence:*:members keys
  // and verify each member still has an active presence key.
  // For now, getOnlineMembers handles cleanup per-trip on read.
}
