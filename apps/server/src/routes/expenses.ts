import { Router, Request, Response, RequestHandler } from 'express';
import { requireRole, requireMember } from '../middleware/rbac.js';
import {
  validate,
  createExpenseSchema,
  updateExpenseSchema,
  recordSettlementSchema,
} from '../validation/schemas.js';
import {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  recordSettlement,
  getSettlements,
  getTripSummary,
  computeSettlements,
} from '../services/expense.service.js';
import { ErrorCodes } from '@tripsync/shared';
import { getIoInstance } from '../socket/io-instance.js';

/**
 * Broadcasts an expense-related event to everyone in the trip room. The
 * originating client is included (REST calls have no socket to exclude) and
 * relies on `userId` in the payload to dedupe against its own optimistic
 * update. Never throws — a socket failure must not break the REST response.
 */
function broadcastToTrip(tripId: string, event: string, payload: Record<string, unknown>): void {
  try {
    getIoInstance().to(`trip:${tripId}`).emit(event, payload);
  } catch (err) {
    console.error(`Failed to broadcast ${event}:`, err);
  }
}

// ─── Trip-scoped expense routes (mounted on /api/trips/:id/expenses) ─────────

export const tripExpenseRoutes = Router({ mergeParams: true });

// The parent trips router already applies `authenticate`.

/**
 * POST /api/trips/:id/expenses
 * Create an expense with calculated splits. Editor or Owner role required.
 */
tripExpenseRoutes.post(
  '/',
  requireRole('owner', 'editor') as RequestHandler,
  validate(createExpenseSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;

      const result = await createExpense(tripId, req.body);

      if ('error' in result) {
        if (result.error === ErrorCodes.EXPENSE_PERCENTAGES_INVALID) {
          res.status(400).json({
            code: ErrorCodes.EXPENSE_PERCENTAGES_INVALID,
            message: 'Percentages must sum to 100',
          });
          return;
        }
        res.status(400).json({
          code: ErrorCodes.EXPENSE_INVALID_SPLIT,
          message: 'Owed and paid shares must each sum to the expense total',
        });
        return;
      }

      broadcastToTrip(tripId, 'expense:created', {
        expense: result.expense,
        splits: result.splits,
        userId: req.auth?.userId,
      });

      res.status(201).json({ expense: result.expense, splits: result.splits });
    } catch (error) {
      console.error('Create expense error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * GET /api/trips/:id/expenses?limit=20&cursor=<lastId>
 * List expenses (with splits) for a trip, newest first. Member role required.
 *
 * Uses cursor-based (keyset) pagination: pass `cursor` = the id of the last
 * expense you already have to fetch the next older page. `nextCursor` in the
 * response is the last expense's id (or null when the page wasn't full). When
 * neither `limit` nor `cursor` is supplied the full list is returned, so older
 * callers that expect every expense keep working.
 */
tripExpenseRoutes.get(
  '/',
  requireMember() as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;

      const hasPagination =
        req.query.limit !== undefined || req.query.cursor !== undefined;
      const limit = hasPagination
        ? Math.min(parseInt(req.query.limit as string) || 20, 100)
        : undefined;
      const cursor = (req.query.cursor as string) || null;

      const expenses = await getExpenses(tripId, limit, cursor);
      const nextCursor =
        limit != null && expenses.length === limit
          ? expenses[expenses.length - 1].id
          : null;

      res.status(200).json({ expenses, nextCursor });
    } catch (error) {
      console.error('List expenses error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * PUT /api/trips/:id/expenses/:expenseId
 * Edit an expense: recompute splits and balances, log the edit. Editor or
 * Owner role required. The expense must belong to the trip in the URL.
 */
tripExpenseRoutes.put(
  '/:expenseId',
  requireRole('owner', 'editor') as RequestHandler,
  validate(updateExpenseSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;
      const expenseId = req.params.expenseId as string;
      const actorId = req.auth?.userId;

      const result = await updateExpense(expenseId, { ...req.body, actorId }, tripId);

      if (result === null) {
        res.status(404).json({
          code: 'EXPENSE_NOT_FOUND',
          message: 'Expense not found',
        });
        return;
      }

      if ('error' in result) {
        if (result.error === ErrorCodes.EXPENSE_PERCENTAGES_INVALID) {
          res.status(400).json({
            code: ErrorCodes.EXPENSE_PERCENTAGES_INVALID,
            message: 'Percentages must sum to 100',
          });
          return;
        }
        res.status(400).json({
          code: ErrorCodes.EXPENSE_INVALID_SPLIT,
          message: 'Owed and paid shares must each sum to the expense total',
        });
        return;
      }

      broadcastToTrip(tripId, 'expense:updated', {
        expense: result.expense,
        splits: result.splits,
        userId: actorId,
      });

      res.status(200).json({ expense: result.expense, splits: result.splits });
    } catch (error) {
      console.error('Update expense error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * DELETE /api/trips/:id/expenses/:expenseId
 * Soft-delete an expense so it is excluded from totals and balances. Editor or
 * Owner role required. The expense must belong to the trip in the URL.
 */
tripExpenseRoutes.delete(
  '/:expenseId',
  requireRole('owner', 'editor') as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;
      const expenseId = req.params.expenseId as string;
      const actorId = req.auth?.userId;

      const deleted = await deleteExpense(expenseId, actorId, tripId);
      if (!deleted) {
        res.status(404).json({
          code: 'EXPENSE_NOT_FOUND',
          message: 'Expense not found',
        });
        return;
      }

      broadcastToTrip(tripId, 'expense:deleted', {
        expenseId,
        userId: actorId,
      });

      res.status(200).json({ expense: deleted });
    } catch (error) {
      console.error('Delete expense error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

// ─── Trip-scoped balance route (mounted on /api/trips/:id/balances) ──────────

export const tripBalanceRoutes = Router({ mergeParams: true });

/**
 * GET /api/trips/:id/balances
 * Return the trip total plus each member's net balance (integer minor units)
 * and the minimal suggested settlements to zero out balances. Member role.
 */
tripBalanceRoutes.get(
  '/',
  requireMember() as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;

      const summary = await getTripSummary(tripId);
      res.status(200).json({ summary });
    } catch (error) {
      console.error('Get balances error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

// ─── Trip-scoped settlement routes (mounted on /api/trips/:id/settlements) ────

export const tripSettlementRoutes = Router({ mergeParams: true });

/**
 * GET /api/trips/:id/settlements
 * Return the trip summary (net balances + suggested minimal transactions),
 * the recorded settlement payments, and the suggested settlements. Member role.
 */
tripSettlementRoutes.get(
  '/',
  requireMember() as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;

      const [summary, payments, suggested] = await Promise.all([
        getTripSummary(tripId),
        getSettlements(tripId),
        computeSettlements(tripId),
      ]);

      // `payments` are recorded settlement rows; `suggested` are the minimal
      // transactions that would zero every remaining balance.
      res.status(200).json({ summary, suggested, payments, settlements: payments });
    } catch (error) {
      console.error('Get settlements error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * POST /api/trips/:id/settlements
 * Record a settlement payment between two members (supports partial
 * settlements). Editor or Owner role required.
 */
tripSettlementRoutes.post(
  '/',
  requireRole('owner', 'editor') as RequestHandler,
  validate(recordSettlementSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const tripId = req.params.id as string;
      const { fromUserId, toUserId, amountMinor, note } = req.body;

      const settlement = await recordSettlement(
        tripId,
        fromUserId,
        toUserId,
        amountMinor,
        note ?? null
      );

      broadcastToTrip(tripId, 'expense:settled', {
        settlement,
        userId: req.auth?.userId,
      });

      res.status(201).json({ settlement });
    } catch (error) {
      console.error('Record settlement error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);


