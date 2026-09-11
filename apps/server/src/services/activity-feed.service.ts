import { eq, desc, and, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { activityLog, users } from '../db/schema.js';
import { getIoInstance } from '../socket/io-instance.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActionType =
  | 'created'
  | 'updated'
  | 'moved'
  | 'deleted'
  | 'voted'
  | 'resolved'
  | 'settled';
export type EntityType = 'activity_block' | 'vote' | 'expense' | 'trip_member' | 'settlement';

export interface ActivityLogEntry {
  id: string;
  tripId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * An activity log entry enriched with the actor's display name and a
 * human-readable description. This is the exact shape returned per item by
 * `getActivityFeed` (and `GET /api/trips/:id/activity`), so the same object
 * can be rendered by the client whether it arrives via REST or a live
 * `activity:new` socket event.
 */
export interface EnrichedActivityEntry extends ActivityLogEntry {
  userName: string;
  avatarId: number | null;
  description: string;
}

// ─── Service Methods ─────────────────────────────────────────────────────────

/**
 * Logs an action to the activity feed. Failures are caught and logged
 * to prevent blocking the main operation.
 */
export async function logAction(
  tripId: string,
  userId: string,
  action: ActionType,
  entityType: EntityType,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<ActivityLogEntry | null> {
  try {
    const [entry] = await db
      .insert(activityLog)
      .values({
        tripId,
        userId,
        action,
        entityType,
        entityId,
        metadata: metadata ?? null,
      })
      .returning();

    return entry as unknown as ActivityLogEntry;
  } catch (error) {
    console.error('Failed to log activity:', error);
    return null;
  }
}

/**
 * Enriches a raw activity log entry with the actor's display name and a
 * formatted description, producing the same per-item shape as
 * `getActivityFeed`. The actor's name is resolved from the users table,
 * falling back to 'Someone' if the user can't be found.
 */
export async function buildActivityEntry(
  entry: ActivityLogEntry
): Promise<EnrichedActivityEntry> {
  const [user] = await db
    .select({ name: users.name, avatarId: users.avatarId })
    .from(users)
    .where(eq(users.id, entry.userId));

  const userName = user?.name ?? 'Someone';

  return {
    ...entry,
    userName,
    avatarId: user?.avatarId ?? null,
    description: formatDescription(entry, userName),
  };
}

/**
 * Logs an action and broadcasts a fully-formed `activity:new` event to the
 * trip room, so every connected client can render the entry directly instead
 * of reconstructing text from raw payloads. The event is emitted to the whole
 * room (the actor included); clients de-dupe by entry id and only toast for
 * other users' actions.
 *
 * Fully non-blocking: every failure (DB, user lookup, or socket) is caught so
 * the caller's main operation is never affected. Returns the enriched entry on
 * success, or null if the action could not be logged.
 */
export async function logActivityAndBroadcast(
  tripId: string,
  userId: string,
  action: ActionType,
  entityType: EntityType,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<EnrichedActivityEntry | null> {
  try {
    const entry = await logAction(tripId, userId, action, entityType, entityId, metadata);
    if (!entry) return null;

    const enriched = await buildActivityEntry(entry);

    try {
      getIoInstance().to(`trip:${tripId}`).emit('activity:new', enriched);
    } catch (err) {
      // Socket server may not be initialized (e.g. in tests); the activity was
      // still logged, so this is non-fatal.
      console.error('Failed to broadcast activity:new:', err);
    }

    return enriched;
  } catch (err) {
    console.error('Failed to log/broadcast activity:', err);
    return null;
  }
}

/**
 * Gets recent activity log entries for a trip, ordered by createdAt DESC.
 */
export async function getRecentActions(
  tripId: string,
  limit = 20,
  offset = 0
): Promise<ActivityLogEntry[]> {
  const entries = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.tripId, tripId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .offset(offset);

  return entries as unknown as ActivityLogEntry[];
}

/**
 * Formats an activity log entry into a human-readable description.
 */
export function formatDescription(entry: ActivityLogEntry, userName: string): string {
  const metadata = entry.metadata ?? {};
  const entityName = (metadata.title as string) || entry.entityType;

  // Settlements read as a payment between two people, so they resolve their own
  // counterparty/amount from metadata rather than using the generic entityName.
  const counterparty = (metadata.counterparty as string) || 'someone';
  const amount = (metadata.amount as string) || 'a payment';

  const templates: Record<ActionType, string> = {
    created: `${userName} added '${entityName}'`,
    updated: `${userName} updated '${entityName}'`,
    moved: `${userName} moved '${entityName}' from Day ${metadata.fromDay} to Day ${metadata.toDay}`,
    deleted: `${userName} removed '${entityName}'`,
    voted: `${userName} voted on '${entityName}'`,
    resolved: `${userName} resolved poll '${entityName}'`,
    settled: `${userName} paid ${counterparty} ${amount}`,
  };

  return templates[entry.action as ActionType] || `${userName} performed '${entry.action}' on '${entityName}'`;
}

/**
 * Resolves a cursor (the id of the last item on the previous page) into the
 * keyset condition used to fetch the next page. The feed is ordered by
 * (createdAt DESC, id DESC), so "after" a cursor means strictly older rows:
 * either an earlier createdAt, or the same createdAt with a smaller id (the
 * id tie-break keeps pagination stable when timestamps collide).
 *
 * Returns null when the cursor id can't be found, in which case the caller
 * falls back to the first page.
 */
async function resolveActivityCursor(cursor: string): Promise<SQL | null> {
  const [row] = await db
    .select({ createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(eq(activityLog.id, cursor));

  if (!row) return null;

  return or(
    lt(activityLog.createdAt, row.createdAt),
    and(eq(activityLog.createdAt, row.createdAt), lt(activityLog.id, cursor))
  ) as SQL;
}

/**
 * Gets recent activity feed entries for a trip with user names and formatted
 * descriptions, ordered newest-first.
 *
 * Supports two pagination styles:
 *   - Cursor (preferred): pass `cursor` = the id of the last item you already
 *     have; returns the next `limit` older entries. Stable under inserts.
 *   - Offset (legacy): pass `offset` to skip N rows. Kept for backward
 *     compatibility; ignored when a valid `cursor` is supplied.
 *
 * Clients derive the next cursor from the id of the last returned entry, and
 * treat `entries.length < limit` as "no more pages".
 */
export async function getActivityFeed(
  tripId: string,
  limit = 20,
  offset = 0,
  cursor?: string | null
) {
  // Cursor pagination takes precedence over offset when both are present.
  const cursorCondition = cursor ? await resolveActivityCursor(cursor) : null;

  const whereCondition = cursorCondition
    ? and(eq(activityLog.tripId, tripId), cursorCondition)
    : eq(activityLog.tripId, tripId);

  const entries = await db
    .select({
      id: activityLog.id,
      tripId: activityLog.tripId,
      userId: activityLog.userId,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      metadata: activityLog.metadata,
      createdAt: activityLog.createdAt,
      userName: users.name,
      avatarId: users.avatarId,
    })
    .from(activityLog)
    .innerJoin(users, eq(activityLog.userId, users.id))
    .where(whereCondition)
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    // Offset is skipped in cursor mode (keyset pagination handles the position).
    .limit(limit)
    .offset(cursorCondition ? 0 : offset);

  return entries.map((entry) => {
    const logEntry: ActivityLogEntry = {
      id: entry.id,
      tripId: entry.tripId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata as Record<string, unknown> | null,
      createdAt: entry.createdAt,
    };

    return {
      ...logEntry,
      userName: entry.userName,
      avatarId: entry.avatarId,
      description: formatDescription(logEntry, entry.userName),
    };
  });
}
