import { eq, and, isNull, desc, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { expenses, expenseSplits, settlements, users } from '../db/schema.js';
import { getMembers } from './trip.service.js';
import { logActivityAndBroadcast } from './activity-feed.service.js';
import { ErrorCodes, type SettlementTransaction } from '@tripsync/shared';

// ─── Split Calculation Utilities (integer minor units) ───────────────────────
//
// All monetary math is performed in integer minor units (e.g. paise/cents).
// Decimal representations are only ever produced for display, never for
// arithmetic, so computed amounts can never drift due to floating-point error.

/**
 * Distributes `totalMinor` minor units equally among `memberCount` members.
 * Any remainder minor units are assigned 1-each to the first members in order,
 * so the returned shares always sum exactly to `totalMinor`.
 */
export function calculateEqualSplitMinor(totalMinor: number, memberCount: number): number[] {
  if (memberCount <= 0) return [];

  const base = Math.floor(totalMinor / memberCount);
  const remainder = totalMinor - base * memberCount;

  const splits: number[] = [];
  for (let i = 0; i < memberCount; i++) {
    splits.push(base + (i < remainder ? 1 : 0));
  }
  return splits;
}

/**
 * Computes owed shares (in minor units) from an array of percentages.
 * Each share is rounded to the nearest minor unit; any rounding remainder is
 * absorbed into the last share so the totals reconcile exactly to `totalMinor`.
 */
export function calculatePercentageSplitMinor(totalMinor: number, percentages: number[]): number[] {
  if (percentages.length === 0) return [];

  const splits: number[] = [];
  let assigned = 0;

  for (let i = 0; i < percentages.length; i++) {
    if (i === percentages.length - 1) {
      // Assign the remaining minor units to the final member to avoid loss.
      splits.push(totalMinor - assigned);
    } else {
      const share = Math.round((totalMinor * percentages[i]) / 100);
      assigned += share;
      splits.push(share);
    }
  }
  return splits;
}

/** Sums an array of integer minor-unit values. */
export function sumMinor(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Verifies that a set of custom owed shares sums exactly to the expense total.
 * Because everything is in integer minor units, the comparison is exact.
 */
export function validateCustomSplitMinor(totalMinor: number, owedShares: number[]): boolean {
  return sumMinor(owedShares) === totalMinor;
}

/** Verifies that a set of percentages sums to 100 within a ±0.01 tolerance. */
export function validatePercentageSplit(percentages: number[]): boolean {
  const sum = percentages.reduce((acc, p) => acc + p, 0);
  return Math.abs(sum - 100) < 0.01;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CustomSplitInput {
  userId: string;
  owedMinor: number;
}

export interface PercentageSplitInput {
  userId: string;
  percentage: number;
}

export interface PayerInput {
  userId: string;
  paidMinor: number;
}

export interface CreateExpenseInput {
  title: string;
  amountMinor: number;
  currency?: string;
  /** Single-payer convenience: this user paid the full amount. */
  paidBy?: string;
  /** Multi-payer support: explicit paid shares per payer. */
  payers?: PayerInput[];
  splitType: 'equal' | 'custom' | 'percentage';
  activityBlockId?: string | null;
  customSplits?: CustomSplitInput[];
  percentageSplits?: PercentageSplitInput[];
}

export interface UpdateExpenseInput extends Partial<CreateExpenseInput> {
  /** User performing the edit, for activity logging. */
  actorId?: string;
}

interface SplitRow {
  userId: string;
  owedMinor: number;
  paidMinor: number;
}

// ─── Split Assembly ──────────────────────────────────────────────────────────

/**
 * Resolves the paid shares for an expense. Uses explicit `payers` when given,
 * otherwise falls back to the single-payer `paidBy` covering the full amount.
 * Returns an error code when the paid shares do not reconcile to the total.
 */
function resolvePaidShares(
  input: Pick<CreateExpenseInput, 'payers' | 'paidBy' | 'amountMinor'>
): { paidByUserId: string; shares: PayerInput[] } | { error: string } {
  if (input.payers && input.payers.length > 0) {
    // Enforce sum(paidMinor) == amount for the multi-payer case.
    if (sumMinor(input.payers.map((p) => p.paidMinor)) !== input.amountMinor) {
      return { error: ErrorCodes.EXPENSE_INVALID_SPLIT };
    }
    // The stored `paidBy` is the largest contributor (deterministic primary).
    const primary = [...input.payers].sort((a, b) => b.paidMinor - a.paidMinor)[0];
    return { paidByUserId: primary.userId, shares: input.payers };
  }

  if (input.paidBy) {
    return {
      paidByUserId: input.paidBy,
      shares: [{ userId: input.paidBy, paidMinor: input.amountMinor }],
    };
  }

  return { error: ErrorCodes.EXPENSE_INVALID_SPLIT };
}

/**
 * Builds the per-user split rows (owed + paid shares in minor units) for an
 * expense. Validates every invariant before returning, so callers never
 * persist a partially-computed expense.
 *
 * Invariants enforced:
 *   sum(owedMinor) === amountMinor
 *   sum(paidMinor) === amountMinor
 */
async function buildSplitRows(
  tripId: string,
  input: CreateExpenseInput
): Promise<{ rows: SplitRow[]; paidByUserId: string } | { error: string }> {
  // ── Owed shares ──
  let owedShares: { userId: string; owedMinor: number }[] = [];

  if (input.splitType === 'equal') {
    const members = await getMembers(tripId);
    if (members.length === 0) {
      return { error: ErrorCodes.EXPENSE_INVALID_SPLIT };
    }
    const amounts = calculateEqualSplitMinor(input.amountMinor, members.length);
    owedShares = members.map((m, i) => ({ userId: m.userId, owedMinor: amounts[i] }));
  } else if (input.splitType === 'custom') {
    const customSplits = input.customSplits ?? [];
    if (
      customSplits.length === 0 ||
      !validateCustomSplitMinor(input.amountMinor, customSplits.map((s) => s.owedMinor))
    ) {
      return { error: ErrorCodes.EXPENSE_INVALID_SPLIT };
    }
    owedShares = customSplits.map((s) => ({ userId: s.userId, owedMinor: s.owedMinor }));
  } else {
    // percentage
    const percentageSplits = input.percentageSplits ?? [];
    if (
      percentageSplits.length === 0 ||
      !validatePercentageSplit(percentageSplits.map((s) => s.percentage))
    ) {
      return { error: ErrorCodes.EXPENSE_PERCENTAGES_INVALID };
    }
    const amounts = calculatePercentageSplitMinor(
      input.amountMinor,
      percentageSplits.map((s) => s.percentage)
    );
    owedShares = percentageSplits.map((s, i) => ({ userId: s.userId, owedMinor: amounts[i] }));
  }

  // ── Paid shares ──
  const paid = resolvePaidShares(input);
  if ('error' in paid) {
    return { error: paid.error };
  }

  // ── Merge owed + paid into per-user rows ──
  const rowMap = new Map<string, SplitRow>();
  const ensure = (userId: string): SplitRow => {
    let row = rowMap.get(userId);
    if (!row) {
      row = { userId, owedMinor: 0, paidMinor: 0 };
      rowMap.set(userId, row);
    }
    return row;
  };

  for (const o of owedShares) {
    ensure(o.userId).owedMinor += o.owedMinor;
  }
  for (const p of paid.shares) {
    ensure(p.userId).paidMinor += p.paidMinor;
  }

  const rows = Array.from(rowMap.values());

  // ── Final invariant check ──
  if (
    sumMinor(rows.map((r) => r.owedMinor)) !== input.amountMinor ||
    sumMinor(rows.map((r) => r.paidMinor)) !== input.amountMinor
  ) {
    return { error: ErrorCodes.EXPENSE_INVALID_SPLIT };
  }

  return { rows, paidByUserId: paid.paidByUserId };
}

// ─── Expense Creation ────────────────────────────────────────────────────────

/**
 * Creates an expense and its associated splits (owed + paid shares) in integer
 * minor units. Supports single- and multi-payer expenses.
 *
 * Returns `{ expense, splits }` on success, or `{ error }` when validation
 * fails (invalid split/percentage sum, or paid shares that don't reconcile).
 */
export async function createExpense(tripId: string, input: CreateExpenseInput) {
  const built = await buildSplitRows(tripId, input);
  if ('error' in built) {
    return { error: built.error };
  }

  const [expense] = await db
    .insert(expenses)
    .values({
      tripId,
      title: input.title,
      amountMinor: input.amountMinor,
      currency: input.currency ?? 'INR',
      paidBy: built.paidByUserId,
      splitType: input.splitType,
      activityBlockId: input.activityBlockId ?? null,
    })
    .returning();

  const splits = await db
    .insert(expenseSplits)
    .values(
      built.rows.map((r) => ({
        expenseId: expense.id,
        userId: r.userId,
        owedMinor: r.owedMinor,
        paidMinor: r.paidMinor,
      }))
    )
    .returning();

  logActivityAndBroadcast(tripId, built.paidByUserId, 'created', 'expense', expense.id, {
    title: input.title,
  }).catch(() => {});

  return { expense, splits };
}

// ─── Expense Editing ─────────────────────────────────────────────────────────

/**
 * Edits an existing (non-deleted) expense, recomputing its splits and balances
 * from the merged input, and logs the edit to the Activity_Feed.
 *
 * Returns `{ expense, splits }` on success, `{ error }` on validation failure,
 * or `null` when the expense does not exist or is already soft-deleted.
 *
 * When `tripId` is provided, the expense must belong to that trip; a mismatch
 * is treated as not-found (returns `null`) so callers can scope edits to a trip.
 */
export async function updateExpense(
  expenseId: string,
  input: UpdateExpenseInput,
  tripId?: string
) {
  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), isNull(expenses.deletedAt)))
    .limit(1);

  if (!existing) return null;
  if (tripId && existing.tripId !== tripId) return null;

  // Merge the patch over the existing record so unspecified fields are kept.
  const merged: CreateExpenseInput = {
    title: input.title ?? existing.title,
    amountMinor: input.amountMinor ?? existing.amountMinor,
    currency: input.currency ?? existing.currency,
    splitType: input.splitType ?? (existing.splitType as CreateExpenseInput['splitType']),
    activityBlockId:
      input.activityBlockId !== undefined ? input.activityBlockId : existing.activityBlockId,
    paidBy: input.paidBy,
    payers: input.payers,
    customSplits: input.customSplits,
    percentageSplits: input.percentageSplits,
  };

  // If no payer info was supplied in the patch, keep the existing primary payer.
  if (!merged.paidBy && !merged.payers) {
    merged.paidBy = existing.paidBy;
  }

  const built = await buildSplitRows(existing.tripId, merged);
  if ('error' in built) {
    return { error: built.error };
  }

  const [expense] = await db
    .update(expenses)
    .set({
      title: merged.title,
      amountMinor: merged.amountMinor,
      currency: merged.currency ?? 'INR',
      paidBy: built.paidByUserId,
      splitType: merged.splitType,
      activityBlockId: merged.activityBlockId ?? null,
    })
    .where(eq(expenses.id, expenseId))
    .returning();

  // Recompute splits: replace the old rows entirely.
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

  const splits = await db
    .insert(expenseSplits)
    .values(
      built.rows.map((r) => ({
        expenseId,
        userId: r.userId,
        owedMinor: r.owedMinor,
        paidMinor: r.paidMinor,
      }))
    )
    .returning();

  logActivityAndBroadcast(
    existing.tripId,
    input.actorId ?? built.paidByUserId,
    'updated',
    'expense',
    expenseId,
    { title: merged.title }
  ).catch(() => {});

  return { expense, splits };
}

// ─── Expense Deletion (soft delete) ──────────────────────────────────────────

/**
 * Soft-deletes an expense: sets `deletedAt` so it is retained for history but
 * excluded from all totals, balances, and settlement calculations. Logs the
 * deletion to the Activity_Feed. Returns the updated row, or null if not found
 * (or already deleted).
 *
 * When `tripId` is provided, the expense must belong to that trip; a mismatch
 * matches no row and returns `null` so callers can scope deletes to a trip.
 */
export async function deleteExpense(expenseId: string, actorId?: string, tripId?: string) {
  const [deleted] = await db
    .update(expenses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(expenses.id, expenseId),
        isNull(expenses.deletedAt),
        tripId ? eq(expenses.tripId, tripId) : undefined
      )
    )
    .returning();

  if (!deleted) return null;

  logActivityAndBroadcast(deleted.tripId, actorId ?? deleted.paidBy, 'deleted', 'expense', expenseId, {
    title: deleted.title,
  }).catch(() => {});

  return deleted;
}

// ─── Settlements ─────────────────────────────────────────────────────────────

/**
 * Records a settlement payment from one member to another (in minor units).
 * Supports partial settlements: the amount need not clear the full balance.
 * Balances are always derived from paid/owed shares minus recorded settlements,
 * so no per-split flag is mutated.
 */
export async function recordSettlement(
  tripId: string,
  fromUserId: string,
  toUserId: string,
  amountMinor: number,
  note?: string | null
) {
  const [settlement] = await db
    .insert(settlements)
    .values({
      tripId,
      fromUserId,
      toUserId,
      amountMinor,
      note: note ?? null,
    })
    .returning();

  // Log to the activity feed and broadcast `activity:new` so other trip members
  // get the feed entry + a toast. Fully non-blocking: any feed/socket failure
  // must never break settlement recording. The entry's userId is the payer
  // (fromUser), so it reads "{payer} paid {recipient} {amount}" and the payer
  // (if they're the current viewer) doesn't get a duplicate toast.
  (async () => {
    const [toUser] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, toUserId));
    const toUserName = toUser?.name ?? 'Someone';

    await logActivityAndBroadcast(tripId, fromUserId, 'settled', 'settlement', settlement.id, {
      counterparty: toUserName,
      amount: formatMoneyMinor(amountMinor),
      amountMinor,
      toUserId,
    });
  })().catch(() => {});

  return settlement;
}

/**
 * Formats integer minor units into an INR display string with 2 decimals and
 * grouped thousands (e.g. 50000 -> "INR 500.00"). Settlements carry no currency
 * column and this app is INR-centric, so INR is the fixed default.
 */
function formatMoneyMinor(amountMinor: number): string {
  const major = amountMinor / 100;
  const formatted = major.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `INR ${formatted}`;
}

/** Lists all settlement records for a trip. */
export async function getSettlements(tripId: string) {
  return db.select().from(settlements).where(eq(settlements.tripId, tripId));
}

// ─── Balance / Summary Computation ───────────────────────────────────────────

/**
 * Single aggregation pass over a trip's non-deleted expenses. Returns both the
 * trip total and each member's net balance (all in integer minor units), so
 * that `getBalances` and `getTripSummary` share one consistent computation.
 *
 * netBalance = SUM(paidMinor) - SUM(owedMinor), then adjusted by recorded
 * settlements: a debtor paying a creditor moves the debtor's balance toward
 * zero (+amount) and the creditor's balance down (-amount).
 *
 * A positive balance means the member is owed money; negative means they owe.
 */
async function aggregateTrip(
  tripId: string
): Promise<{ totalMinor: number; balances: Map<string, number> }> {
  const activeExpenses = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt)));

  const balances = new Map<string, number>();
  const bump = (userId: string, delta: number) =>
    balances.set(userId, (balances.get(userId) ?? 0) + delta);

  let totalMinor = 0;
  for (const expense of activeExpenses) {
    totalMinor += expense.amountMinor;
    const splits = await db
      .select()
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, expense.id));
    for (const s of splits) {
      bump(s.userId, s.paidMinor - s.owedMinor);
    }
  }

  // Fold in recorded settlements with a consistent sign convention:
  // from_user += amount (they paid, so they owe less), to_user -= amount.
  const tripSettlements = await getSettlements(tripId);
  for (const st of tripSettlements) {
    bump(st.fromUserId, st.amountMinor);
    bump(st.toUserId, -st.amountMinor);
  }

  return { totalMinor, balances };
}

/**
 * Computes each member's net balance for a trip as a Map<userId, balanceMinor>
 * in integer minor units. Positive = the member is owed money; negative = the
 * member owes. Zero-balance members are still included in the map.
 */
export async function getBalances(tripId: string): Promise<Map<string, number>> {
  const { balances } = await aggregateTrip(tripId);
  return balances;
}

/**
 * Greedy min-transactions debt simplification over integer minor-unit balances.
 *
 * Separates members into creditors (positive balance) and debtors (negative),
 * sorts both descending by magnitude, then repeatedly matches the largest
 * creditor with the largest debtor for min(creditor, debtor) until settled.
 * Produces at most n-1 transactions for n members with non-zero balances.
 *
 * All arithmetic is exact because balances are integer minor units.
 */
export function simplifyDebts(balances: Map<string, number>): SettlementTransaction[] {
  const transactions: SettlementTransaction[] = [];

  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];

  for (const [userId, balance] of balances) {
    if (balance > 0) creditors.push({ userId, amount: balance });
    else if (balance < 0) debtors.push({ userId, amount: -balance });
  }

  // Sort descending by amount for greedy matching (deterministic order).
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const settleAmount = Math.min(creditors[i].amount, debtors[j].amount);

    transactions.push({
      from: debtors[j].userId,
      to: creditors[i].userId,
      amountMinor: settleAmount,
      currency: 'INR',
    });

    creditors[i].amount -= settleAmount;
    debtors[j].amount -= settleAmount;

    if (creditors[i].amount === 0) i++;
    if (debtors[j].amount === 0) j++;
  }

  return transactions;
}

/**
 * Computes the minimal set of settlement transactions that zero out every
 * member's net balance for a trip: net balances via `getBalances`, then the
 * greedy `simplifyDebts` matching.
 */
export async function computeSettlements(tripId: string): Promise<SettlementTransaction[]> {
  const balances = await getBalances(tripId);
  return simplifyDebts(balances);
}

/**
 * Trip expense summary: total cost, per-member net balance (all in integer
 * minor units), and the minimal suggested settlements to zero out balances.
 */
export async function getTripSummary(tripId: string) {
  const { totalMinor, balances } = await aggregateTrip(tripId);

  const memberBalances = Array.from(balances.entries()).map(([userId, balanceMinor]) => ({
    userId,
    balanceMinor,
  }));

  return { totalMinor, memberBalances, settlements: simplifyDebts(balances) };
}

// ─── Link to Activity Block ──────────────────────────────────────────────────

/**
 * Links an expense to an existing activity block by setting its
 * activityBlockId foreign key. Returns null if the expense is not found.
 */
export async function linkToBlock(expenseId: string, blockId: string) {
  const [updated] = await db
    .update(expenses)
    .set({ activityBlockId: blockId })
    .where(eq(expenses.id, expenseId))
    .returning();

  return updated ?? null;
}

// ─── List Expenses ───────────────────────────────────────────────────────────

/**
 * Resolves an expense cursor (id of the last item on the previous page) into
 * the keyset condition for the next page. Expenses are ordered
 * (createdAt DESC, id DESC), so "after" the cursor means strictly older rows,
 * with the id tie-break keeping pagination stable when timestamps collide.
 * Returns null when the cursor id can't be found (caller loads the first page).
 */
async function resolveExpenseCursor(cursor: string): Promise<SQL | null> {
  const [row] = await db
    .select({ createdAt: expenses.createdAt })
    .from(expenses)
    .where(eq(expenses.id, cursor));

  if (!row) return null;

  return or(
    lt(expenses.createdAt, row.createdAt),
    and(eq(expenses.createdAt, row.createdAt), lt(expenses.id, cursor))
  ) as SQL;
}

/**
 * Lists non-deleted expenses for a trip (newest first), each with its splits
 * joined in. Soft-deleted expenses are excluded.
 *
 * Pagination:
 *   - When `limit` is omitted, every expense is returned (legacy full-list
 *     behavior — balance/summary aggregations rely on this).
 *   - When `limit` is set, at most `limit` rows are returned. Pass `cursor` =
 *     the id of the last item you already have to fetch the next older page.
 */
export async function getExpenses(tripId: string, limit?: number, cursor?: string | null) {
  const cursorCondition = cursor ? await resolveExpenseCursor(cursor) : null;

  const whereCondition = cursorCondition
    ? and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt), cursorCondition)
    : and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt));

  const query = db
    .select()
    .from(expenses)
    .where(whereCondition)
    .orderBy(desc(expenses.createdAt), desc(expenses.id));

  const allExpenses = limit != null ? await query.limit(limit) : await query;

  const expensesWithSplits = await Promise.all(
    allExpenses.map(async (expense) => {
      const splits = await db
        .select()
        .from(expenseSplits)
        .where(eq(expenseSplits.expenseId, expense.id));

      return { ...expense, splits };
    })
  );

  return expensesWithSplits;
}
