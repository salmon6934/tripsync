import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { trips, tripMembers, users } from '../db/schema.js';
import { ErrorCodes } from '@tripsync/shared';
import { generateDays } from './itinerary.service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CreateTripInput {
  title: string;
  destination: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  startDate: Date;
  endDate: Date;
}

interface UpdateTripInput {
  title?: string;
  destination?: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  startDate?: Date;
  endDate?: Date;
  coverImageUrl?: string | null;
  timezone?: string | null;
}

// ─── Service Methods ─────────────────────────────────────────────────────────

/**
 * Creates a new trip and adds the creator as the owner.
 */
export async function createTrip(userId: string, input: CreateTripInput) {
  const inviteCode = nanoid(10);

  const [trip] = await db
    .insert(trips)
    .values({
      title: input.title,
      destination: input.destination,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
      startDate: input.startDate.toISOString().split('T')[0],
      endDate: input.endDate.toISOString().split('T')[0],
      createdBy: userId,
      inviteCode,
    })
    .returning();

  // Add creator as owner
  await db.insert(tripMembers).values({
    tripId: trip.id,
    userId,
    role: 'owner',
  });

  // Auto-generate day entries for each date in the range
  await generateDays(trip.id, input.startDate, input.endDate);

  return trip;
}

/**
 * Gets a trip by ID.
 */
export async function getTrip(tripId: string) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  return trip ?? null;
}

/**
 * Updates a trip's fields.
 */
export async function updateTrip(tripId: string, input: UpdateTripInput) {
  const values: Record<string, unknown> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.destination !== undefined) values.destination = input.destination;
  if (input.destinationLat !== undefined) values.destinationLat = input.destinationLat;
  if (input.destinationLng !== undefined) values.destinationLng = input.destinationLng;
  if (input.startDate !== undefined) values.startDate = input.startDate.toISOString().split('T')[0];
  if (input.endDate !== undefined) values.endDate = input.endDate.toISOString().split('T')[0];
  if (input.coverImageUrl !== undefined) values.coverImageUrl = input.coverImageUrl;
  if (input.timezone !== undefined) values.timezone = input.timezone;

  const [updated] = await db
    .update(trips)
    .set(values)
    .where(eq(trips.id, tripId))
    .returning();

  return updated ?? null;
}

/**
 * Deletes a trip by ID. Cascade rules handle related data.
 */
export async function deleteTrip(tripId: string) {
  const [deleted] = await db
    .delete(trips)
    .where(eq(trips.id, tripId))
    .returning();

  return deleted ?? null;
}

/**
 * Lists all trips where the user is a member, ordered by creation date DESC.
 */
export async function listUserTrips(userId: string) {
  const results = await db
    .select({
      id: trips.id,
      title: trips.title,
      destination: trips.destination,
      destinationLat: trips.destinationLat,
      destinationLng: trips.destinationLng,
      startDate: trips.startDate,
      endDate: trips.endDate,
      createdBy: trips.createdBy,
      inviteCode: trips.inviteCode,
      coverImageUrl: trips.coverImageUrl,
      timezone: trips.timezone,
      createdAt: trips.createdAt,
      role: tripMembers.role,
    })
    .from(tripMembers)
    .innerJoin(trips, eq(tripMembers.tripId, trips.id))
    .where(eq(tripMembers.userId, userId))
    .orderBy(desc(trips.createdAt));

  return results;
}

/**
 * Joins a trip using an invite code. Returns the trip or an error code.
 */
export async function joinTrip(userId: string, inviteCode: string) {
  // Find the trip by invite code
  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.inviteCode, inviteCode))
    .limit(1);

  if (!trip) {
    return { error: ErrorCodes.INVITE_CODE_INVALID };
  }

  // Check if user is already a member
  const [existing] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, trip.id), eq(tripMembers.userId, userId)))
    .limit(1);

  if (existing) {
    // Already a member — return the trip so the caller can redirect to it
    // without creating a duplicate membership.
    return { error: ErrorCodes.MEMBER_ALREADY_EXISTS, trip };
  }

  // Add user as editor
  await db.insert(tripMembers).values({
    tripId: trip.id,
    userId,
    role: 'editor',
  });

  return { trip };
}

/**
 * Gets all members of a trip with user info.
 */
export async function getMembers(tripId: string) {
  const members = await db
    .select({
      id: tripMembers.id,
      tripId: tripMembers.tripId,
      userId: tripMembers.userId,
      role: tripMembers.role,
      joinedAt: tripMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatarId: users.avatarId,
    })
    .from(tripMembers)
    .innerJoin(users, eq(tripMembers.userId, users.id))
    .where(eq(tripMembers.tripId, tripId));

  return members;
}

/**
 * Updates a member's role. Cannot change the owner's role.
 */
export async function updateMemberRole(tripId: string, targetUserId: string, role: 'editor' | 'viewer') {
  // Check the member exists
  const [member] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)))
    .limit(1);

  if (!member) {
    return { error: 'MEMBER_NOT_FOUND' };
  }

  // Prevent changing the owner's role
  if (member.role === 'owner') {
    return { error: ErrorCodes.TRIP_PERMISSION_DENIED };
  }

  const [updated] = await db
    .update(tripMembers)
    .set({ role })
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)))
    .returning();

  return { member: updated };
}

/**
 * Removes a member from a trip. Cannot remove the owner.
 */
export async function removeMember(tripId: string, targetUserId: string) {
  // Check the member exists
  const [member] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)))
    .limit(1);

  if (!member) {
    return { error: 'MEMBER_NOT_FOUND' };
  }

  // Prevent removing the owner
  if (member.role === 'owner') {
    return { error: ErrorCodes.TRIP_PERMISSION_DENIED };
  }

  await db
    .delete(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)));

  return { success: true };
}

/**
 * Checks if a user is a member of a trip. Returns the membership or null.
 */
export async function getMembership(tripId: string, userId: string) {
  const [member] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
    .limit(1);

  return member ?? null;
}
