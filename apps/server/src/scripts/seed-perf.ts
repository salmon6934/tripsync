import bcrypt from 'bcrypt';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { pickAvatarIdForSeed } from '@tripsync/shared';

import { db, client } from '../db/index.js';
import {
  users,
  trips,
  tripMembers,
  days,
  activityBlocks,
  expenses,
  expenseSplits,
  activityLog,
} from '../db/schema.js';

/**
 * Seeds a realistic-volume trip for Lighthouse / performance testing:
 * one login-able user, one trip spanning NUM_DAYS days, BLOCKS activity
 * blocks (with coordinates so the map renders pins), EXPENSES expenses with
 * balanced splits, and an activity-log entry per block so the feed + cursor
 * pagination have data to page through.
 *
 * Idempotent: reuses the seed user if present and deletes any prior perf trip
 * (cascade) before recreating, so re-running does not accumulate data.
 *
 * Usage (from apps/server):
 *   npx dotenv -e ../../.env -- tsx src/scripts/seed-perf.ts
 */

const EMAIL = 'perf@tripsync.local';
const PASSWORD = 'password123';
const TRIP_TITLE = 'Perf Test Trip';
const NUM_DAYS = 10;
const BLOCKS = 50;
const EXPENSES = 20;

const categories = ['food', 'travel', 'stay', 'activity'] as const;
const DAY_MS = 86_400_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function randCoord() {
  // Scatter pins around central Tokyo.
  return {
    lat: 35.6762 + (Math.random() - 0.5) * 0.12,
    lng: 139.6503 + (Math.random() - 0.5) * 0.12,
  };
}

async function main() {
  // 1. User (reuse if present)
  let [user] = await db.select().from(users).where(eq(users.email, EMAIL));
  if (!user) {
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    [user] = await db
      .insert(users)
      .values({
        email: EMAIL,
        name: 'Perf Tester',
        passwordHash,
        avatarId: pickAvatarIdForSeed(EMAIL),
      })
      .returning();
    console.log(`Created user ${EMAIL}`);
  } else {
    console.log(`Reusing existing user ${EMAIL}`);
  }

  // 2. Remove any previous perf trip (cascade clears its days/blocks/expenses/members)
  const existing = await db
    .select()
    .from(trips)
    .where(and(eq(trips.createdBy, user.id), eq(trips.title, TRIP_TITLE)));
  for (const t of existing) {
    await db.delete(trips).where(eq(trips.id, t.id));
  }
  if (existing.length) {
    console.log(`Removed ${existing.length} previous perf trip(s)`);
  }

  // 3. Trip
  const today = new Date();
  const endDate = new Date(today.getTime() + (NUM_DAYS - 1) * DAY_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      title: TRIP_TITLE,
      destination: 'Tokyo, Japan',
      destinationLat: 35.6762,
      destinationLng: 139.6503,
      startDate: isoDate(today),
      endDate: isoDate(endDate),
      createdBy: user.id,
      inviteCode: nanoid(10),
      timezone: 'Asia/Tokyo',
    })
    .returning();

  await db
    .insert(tripMembers)
    .values({ tripId: trip.id, userId: user.id, role: 'owner' });

  // 4. Days
  const dayRows = Array.from({ length: NUM_DAYS }, (_, i) => ({
    tripId: trip.id,
    date: isoDate(new Date(today.getTime() + i * DAY_MS)),
    dayNumber: i + 1,
  }));
  const insertedDays = await db.insert(days).values(dayRows).returning();

  // 5. Blocks (spread across days, chronological positions)
  const blockRows = Array.from({ length: BLOCKS }, (_, i) => {
    const day = insertedDays[i % NUM_DAYS];
    const c = randCoord();
    const hour = String(8 + (Math.floor(i / NUM_DAYS) % 12)).padStart(2, '0');
    return {
      dayId: day.id,
      tripId: trip.id,
      title: `Activity ${i + 1}`,
      description: 'Seeded activity for performance testing.',
      category: categories[i % categories.length],
      startTime: `${hour}:00`,
      endTime: `${hour}:45`,
      locationName: `Place ${i + 1}, Tokyo`,
      latitude: c.lat,
      longitude: c.lng,
      estimatedCost: (i + 1) * 100,
      currency: 'INR',
      position: Math.floor(i / NUM_DAYS) + 1,
      createdBy: user.id,
    };
  });
  const insertedBlocks = await db
    .insert(activityBlocks)
    .values(blockRows)
    .returning();

  // 6. Expenses (single-payer equal split -> self; owed == paid == amount)
  for (let i = 0; i < EXPENSES; i++) {
    const amountMinor = (i + 1) * 5000;
    const linked = i < insertedBlocks.length ? insertedBlocks[i].id : null;
    const [exp] = await db
      .insert(expenses)
      .values({
        tripId: trip.id,
        activityBlockId: linked,
        title: `Expense ${i + 1}`,
        amountMinor,
        currency: 'INR',
        paidBy: user.id,
        splitType: 'equal',
      })
      .returning();
    await db.insert(expenseSplits).values({
      expenseId: exp.id,
      userId: user.id,
      owedMinor: amountMinor,
      paidMinor: amountMinor,
    });
  }

  // 7. Activity log (one per block, for feed + cursor pagination)
  const logRows = insertedBlocks.map((b, i) => ({
    tripId: trip.id,
    userId: user.id,
    action: 'created',
    entityType: 'activity_block',
    entityId: b.id,
    metadata: { title: `Activity ${i + 1}` },
  }));
  await db.insert(activityLog).values(logRows);

  console.log('---');
  console.log('Seed complete.');
  console.log(`Login:   ${EMAIL} / ${PASSWORD}`);
  console.log(`Trip id: ${trip.id}`);
  console.log(`Trip URL: /trip/${trip.id}`);
  console.log(
    `Seeded: ${insertedBlocks.length} blocks, ${EXPENSES} expenses, ${NUM_DAYS} days, ${logRows.length} activity-log entries`
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });