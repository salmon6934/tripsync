// User & Auth
export interface User {
  id: string;
  email: string;
  name: string;
  avatarId: number | null;
  createdAt: Date;
}

export interface Session {
  userId: string;
  token: string;
  expiresAt: Date;
}

// Trip
export type TripRole = 'owner' | 'editor' | 'viewer';

export interface Trip {
  id: string;
  title: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  createdBy: string;
  inviteCode: string;
  coverImageUrl: string | null;
  timezone: string | null;
  createdAt: Date;
}

export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  role: TripRole;
  joinedAt: Date;
}

export interface CreateTripInput {
  title: string;
  destination: string;
  startDate: Date;
  endDate: Date;
}

// Itinerary
export type ActivityCategory = 'food' | 'travel' | 'stay' | 'activity';

export interface Day {
  id: string;
  tripId: string;
  date: Date;
  dayNumber: number;
}

export interface ActivityBlock {
  id: string;
  dayId: string;
  tripId: string;
  title: string;
  description: string | null;
  category: ActivityCategory;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  estimatedCost: number | null;
  currency: string;
  position: number;
  createdBy: string;
  lastEditedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoveBlockInput {
  blockId: string;
  targetDayId: string;
  targetPosition: number;
}

// Presence
export interface PresenceInfo {
  userId: string;
  userName: string;
  avatarId: number | null;
  editingBlockId: string | null;
  lastHeartbeat: Date;
}

export type PresenceEvent =
  | { type: 'presence:join'; userId: string; tripId: string }
  | { type: 'presence:leave'; userId: string; tripId: string }
  | { type: 'presence:editing'; userId: string; tripId: string; blockId: string | null };

// Voting
export interface Vote {
  id: string;
  tripId: string;
  question: string;
  createdBy: string;
  isResolved: boolean;
  winningOptionId: string | null;
  createdAt: Date;
}

export interface VoteOption {
  id: string;
  voteId: string;
  title: string;
  description: string | null;
  link: string | null;
  imageUrl: string | null;
}

export interface VoteResponse {
  id: string;
  voteId: string;
  optionId: string;
  userId: string;
  createdAt: Date;
}

export interface VoteTally {
  optionId: string;
  count: number;
}

// Expenses
export type SplitType = 'equal' | 'custom' | 'percentage';

export interface Expense {
  id: string;
  tripId: string;
  activityBlockId: string | null;
  title: string;
  /** Total amount in integer minor units (e.g. paise/cents). */
  amountMinor: number;
  currency: string;
  paidBy: string;
  splitType: SplitType;
  /** Soft-delete timestamp; null when the expense is active. */
  deletedAt: Date | null;
  createdAt: Date;
}

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  userId: string;
  /** Participant's owed share in integer minor units. */
  owedMinor: number;
  /** Participant's paid share in integer minor units (0 if not a payer). */
  paidMinor: number;
}

/** A recorded settlement payment from one member to another. */
export interface Settlement {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  /** Settled amount in integer minor units. */
  amountMinor: number;
  note: string | null;
  settledAt: Date;
}

export interface SettlementTransaction {
  from: string;
  to: string;
  /** Suggested transaction amount in integer minor units. */
  amountMinor: number;
  currency: string;
}

export interface TripExpenseSummary {
  /** Trip total in integer minor units. */
  totalMinor: number;
  /** Each member's net balance (paid minus owed, adjusted by settlements) in minor units. */
  memberBalances: { userId: string; balanceMinor: number }[];
  settlements: SettlementTransaction[];
}

// Activity Feed
export type ActionType = 'created' | 'updated' | 'moved' | 'deleted' | 'voted' | 'resolved';
export type EntityType = 'activity_block' | 'vote' | 'expense' | 'trip_member';

export interface ActivityLogEntry {
  id: string;
  tripId: string;
  userId: string;
  action: ActionType;
  entityType: EntityType;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// API Error
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Socket.io Event Map
export interface SocketEventMap {
  // Itinerary events
  'block:created': { block: ActivityBlock };
  'block:updated': { block: ActivityBlock; updatedFields: string[] };
  'block:moved': { block: ActivityBlock; fromDayId: string; toDayId: string };
  'block:deleted': { blockId: string; dayId: string };

  // Voting events
  'vote:created': { vote: Vote; options: VoteOption[] };
  'vote:cast': { voteId: string; tallies: VoteTally[] };
  'vote:resolved': { vote: Vote };

  // Presence events
  'presence:join': { userId: string; userName: string; avatarId: number | null };
  'presence:leave': { userId: string };
  'presence:editing': { userId: string; blockId: string | null };

  // Expense events
  'expense:created': { expense: Expense; splits: ExpenseSplit[] };
  'expense:updated': { expense: Expense; splits: ExpenseSplit[] };
  'expense:deleted': { expenseId: string };
  'expense:settled': { settlement: Settlement };
}
