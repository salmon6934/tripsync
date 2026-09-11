import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  real,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // Reference to a built-in default avatar (see @tripsync/shared DEFAULT_AVATARS).
  // Stored as a small integer id rather than a rendered SVG/URL: every surface
  // resolves it to an image client-side via getAvatarSrc(id).
  avatarId: integer('avatar_id'),
  passwordHash: text('password_hash'), // null for OAuth-only users
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Trips ───────────────────────────────────────────────────────────────────

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  destination: text('destination').notNull(),
  // Resolved center of `destination` via geocoding, captured at trip creation.
  // Nullable: trips created before this existed (and any without a geocodable
  // pick) simply fall back to resolving the destination string at search time.
  destinationLat: real('destination_lat'),
  destinationLng: real('destination_lng'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id)
    .notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  coverImageUrl: text('cover_image_url'),
  timezone: text('timezone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Trip Members ────────────────────────────────────────────────────────────

export const tripMembers = pgTable('trip_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
});

// ─── Days ────────────────────────────────────────────────────────────────────

export const days = pgTable('days', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  date: date('date').notNull(),
  dayNumber: integer('day_number').notNull(),
});

// ─── Activity Blocks ─────────────────────────────────────────────────────────

export const activityBlocks = pgTable('activity_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  dayId: uuid('day_id')
    .references(() => days.id, { onDelete: 'cascade' })
    .notNull(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category', {
    enum: ['food', 'travel', 'stay', 'activity'],
  }).notNull(),
  startTime: text('start_time'), // HH:mm format
  endTime: text('end_time'),
  locationName: text('location_name'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  estimatedCost: real('estimated_cost'),
  currency: text('currency').default('INR'),
  position: real('position').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id)
    .notNull(),
  lastEditedBy: uuid('last_edited_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Covers the primary read path: loading a trip's blocks grouped by day and
  // ordered by position (getDaysWithBlocks / itinerary board).
  index('activity_blocks_trip_day_position_idx').on(
    table.tripId,
    table.dayId,
    table.position
  ),
]);

// ─── Votes ───────────────────────────────────────────────────────────────────

export const votes = pgTable('votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  question: text('question').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id)
    .notNull(),
  isResolved: boolean('is_resolved').default(false).notNull(),
  winningOptionId: uuid('winning_option_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Vote Options ────────────────────────────────────────────────────────────

export const voteOptions = pgTable('vote_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  voteId: uuid('vote_id')
    .references(() => votes.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  description: text('description'),
  link: text('link'),
  imageUrl: text('image_url'),
});

// ─── Vote Responses ──────────────────────────────────────────────────────────

export const voteResponses = pgTable('vote_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  voteId: uuid('vote_id')
    .references(() => votes.id, { onDelete: 'cascade' })
    .notNull(),
  optionId: uuid('option_id')
    .references(() => voteOptions.id)
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Expenses ────────────────────────────────────────────────────────────────

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  activityBlockId: uuid('activity_block_id').references(
    () => activityBlocks.id
  ),
  title: text('title').notNull(),
  // Total expense amount stored as integer minor units (e.g. paise/cents).
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').default('INR').notNull(),
  // Primary payer (single-payer convenience). Per-payer paid shares are
  // tracked on expense_splits.paid_minor for multi-payer support.
  paidBy: uuid('paid_by')
    .references(() => users.id)
    .notNull(),
  splitType: text('split_type', {
    enum: ['equal', 'custom', 'percentage'],
  }).notNull(),
  // Soft delete: retained for history, excluded from totals/balances.
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Every expense list / balance aggregation filters by trip_id first.
  index('expenses_trip_id_idx').on(table.tripId),
]);

// ─── Expense Splits ──────────────────────────────────────────────────────────

export const expenseSplits = pgTable('expense_splits', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .references(() => expenses.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  // Each participant carries both an owed share and a paid share, in integer
  // minor units. sum(owedMinor) == sum(paidMinor) == expense.amountMinor.
  owedMinor: integer('owed_minor').notNull(),
  paidMinor: integer('paid_minor').default(0).notNull(),
});

// ─── Settlements ─────────────────────────────────────────────────────────────

// Settlement payment records replace the per-split is_settled boolean model.
// A settlement records a payment from one member to another (supports partial
// settlements). Net balances are derived from paid/owed shares minus settlements.
export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  fromUserId: uuid('from_user_id')
    .references(() => users.id)
    .notNull(),
  toUserId: uuid('to_user_id')
    .references(() => users.id)
    .notNull(),
  amountMinor: integer('amount_minor').notNull(),
  note: text('note'),
  settledAt: timestamp('settled_at').defaultNow().notNull(),
});

// ─── Notifications ───────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type', {
    enum: ['block_created', 'block_moved', 'block_deleted', 'member_joined'],
  }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Activity Log ────────────────────────────────────────────────────────────

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // The activity feed reads by trip_id ordered by created_at DESC, which this
  // composite index serves directly (also backs cursor-based pagination).
  index('activity_log_trip_created_idx').on(table.tripId, table.createdAt),
]);
