import { Router, Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireMember } from '../middleware/rbac.js';
import {
  createTripSchema,
  updateTripSchema,
  joinTripSchema,
  updateMemberRoleSchema,
  createBlockSchema,
  updateBlockSchema,
  moveBlockSchema,
  reorderBlocksSchema,
  validate,
} from '../validation/schemas.js';
import {
  createTrip,
  getTrip,
  updateTrip,
  deleteTrip,
  listUserTrips,
  joinTrip,
  getMembers,
  updateMemberRole,
  removeMember,
} from '../services/trip.service.js';
import { getDaysWithBlocks, createBlock, updateBlock, deleteBlock, moveBlock, reorderBlocks } from '../services/itinerary.service.js';
import { notifyTripMembers } from '../services/notification.service.js';
import { getRecentActions, formatDescription, getActivityFeed } from '../services/activity-feed.service.js';
import { ErrorCodes } from '@tripsync/shared';
import { getIoInstance } from '../socket/io-instance.js';
import { tripVoteRoutes } from './votes.js';
import { tripExpenseRoutes, tripSettlementRoutes, tripBalanceRoutes } from './expenses.js';

const router = Router();

// All trip routes require authentication
router.use(authenticate);

// ─── Join via Invite Code (no trip ID needed) ────────────────────────────────

/**
 * POST /api/trips/join
 * Join a trip using only an invite code. No trip ID required.
 */
router.post('/join', validate(joinTripSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;
    const { inviteCode } = req.body;

    const result = await joinTrip(userId, inviteCode);

    if ('error' in result) {
      if (result.error === ErrorCodes.INVITE_CODE_INVALID) {
        res.status(404).json({
          code: ErrorCodes.INVITE_CODE_INVALID,
          message: 'Invalid invite code',
        });
        return;
      }
      if (result.error === ErrorCodes.MEMBER_ALREADY_EXISTS) {
        res.status(409).json({
          code: ErrorCodes.MEMBER_ALREADY_EXISTS,
          message: 'You are already a member of this trip',
          // Include the trip so clients can redirect to the existing trip view.
          trip: (result as any).trip ?? null,
        });
        return;
      }
    }

    const trip = (result as any).trip;

    // Notify existing members that someone joined
    try {
      const notifications = await notifyTripMembers(
        trip.id,
        userId,
        'member_joined',
        'New member joined',
        `A new member joined "${trip.title}"`
      );
      for (const notif of notifications) {
        getIoInstance().to(`user:${notif.userId}`).emit('notification:new', notif);
      }
    } catch (e) {
      // Don't fail the join if notification fails
      console.error('Failed to send join notifications:', e);
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Join trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Trip CRUD ───────────────────────────────────────────────────────────────

/**
 * POST /api/trips
 * Create a new trip. The authenticated user becomes the owner.
 */
router.post('/', validate(createTripSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;
    const trip = await createTrip(userId, req.body);

    res.status(201).json({ trip });
  } catch (error) {
    console.error('Create trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * GET /api/trips
 * List all trips the authenticated user is a member of.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;
    const trips = await listUserTrips(userId);

    res.status(200).json({ trips });
  } catch (error) {
    console.error('List trips error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * GET /api/trips/:id
 * Get a trip's details. User must be a member.
 */
router.get('/:id', requireMember() as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;

    const trip = await getTrip(tripId);
    if (!trip) {
      res.status(404).json({
        code: ErrorCodes.TRIP_NOT_FOUND,
        message: 'Trip not found',
      });
      return;
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Get trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * PUT /api/trips/:id
 * Update a trip. Owner only.
 */
router.put('/:id', validate(updateTripSchema) as RequestHandler, requireRole('owner') as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;

    const trip = await updateTrip(tripId, req.body);
    if (!trip) {
      res.status(404).json({
        code: ErrorCodes.TRIP_NOT_FOUND,
        message: 'Trip not found',
      });
      return;
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Update trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * DELETE /api/trips/:id
 * Delete a trip. Owner only.
 */
router.delete('/:id', requireRole('owner') as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;

    const trip = await deleteTrip(tripId);
    if (!trip) {
      res.status(404).json({
        code: ErrorCodes.TRIP_NOT_FOUND,
        message: 'Trip not found',
      });
      return;
    }

    res.status(200).json({ message: 'Trip deleted successfully' });
  } catch (error) {
    console.error('Delete trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Invite System ───────────────────────────────────────────────────────────

/**
 * POST /api/trips/:id/join
 * Join a trip using an invite code.
 */
router.post('/:id/join', validate(joinTripSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;
    const { inviteCode } = req.body;

    const result = await joinTrip(userId, inviteCode);

    if ('error' in result) {
      if (result.error === ErrorCodes.INVITE_CODE_INVALID) {
        res.status(404).json({
          code: ErrorCodes.INVITE_CODE_INVALID,
          message: 'Invalid invite code',
        });
        return;
      }
      if (result.error === ErrorCodes.MEMBER_ALREADY_EXISTS) {
        res.status(409).json({
          code: ErrorCodes.MEMBER_ALREADY_EXISTS,
          message: 'You are already a member of this trip',
          // Include the trip so clients can redirect to the existing trip view.
          trip: (result as any).trip ?? null,
        });
        return;
      }
    }

    const trip = (result as any).trip;

    // Notify existing members that someone joined
    try {
      const notifications = await notifyTripMembers(
        trip.id,
        userId,
        'member_joined',
        'New member joined',
        `A new member joined "${trip.title}"`
      );
      for (const notif of notifications) {
        getIoInstance().to(`user:${notif.userId}`).emit('notification:new', notif);
      }
    } catch (e) {
      // Don't fail the join if notification fails
      console.error('Failed to send join notifications:', e);
    }

    res.status(200).json({ trip });
  } catch (error) {
    console.error('Join trip error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Member Management ───────────────────────────────────────────────────────

/**
 * GET /api/trips/:id/members
 * List all members of a trip. User must be a member.
 */
router.get('/:id/members', requireMember() as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;

    const members = await getMembers(tripId);
    res.status(200).json({ members });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * PUT /api/trips/:id/members/:uid
 * Update a member's role. Owner only.
 */
router.put('/:id/members/:uid', validate(updateMemberRoleSchema) as RequestHandler, requireRole('owner') as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;
    const targetUserId = req.params.uid as string;

    const result = await updateMemberRole(tripId, targetUserId, req.body.role);

    if ('error' in result) {
      if (result.error === 'MEMBER_NOT_FOUND') {
        res.status(404).json({
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
        });
        return;
      }
      res.status(403).json({
        code: ErrorCodes.TRIP_PERMISSION_DENIED,
        message: "Cannot change the owner's role",
      });
      return;
    }

    res.status(200).json({ member: result.member });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * DELETE /api/trips/:id/members/:uid
 * Remove a member from a trip.
 * - Owner can remove any non-owner member.
 * - Any member can remove themselves (leave trip), except the owner.
 */
router.delete('/:id/members/:uid', requireMember() as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;
    const targetUserId = req.params.uid as string;
    const { userId } = req.auth!;

    // Self-leave: any non-owner member can remove themselves
    const isSelfLeave = userId === targetUserId;

    if (!isSelfLeave) {
      // Only owner can remove other members
      if (req.memberRole !== 'owner') {
        res.status(403).json({
          code: ErrorCodes.TRIP_PERMISSION_DENIED,
          message: 'Only the trip owner can remove other members',
        });
        return;
      }
    }

    const result = await removeMember(tripId, targetUserId);

    if ('error' in result) {
      if (result.error === 'MEMBER_NOT_FOUND') {
        res.status(404).json({
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
        });
        return;
      }
      res.status(403).json({
        code: ErrorCodes.TRIP_PERMISSION_DENIED,
        message: 'Cannot remove the trip owner',
      });
      return;
    }

    res.status(200).json({ message: isSelfLeave ? 'Left trip successfully' : 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Days / Itinerary ────────────────────────────────────────────────────────

/**
 * GET /api/trips/:id/days
 * Get all days for a trip with their activity blocks. User must be a member.
 */
router.get('/:id/days', requireMember() as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;

    const days = await getDaysWithBlocks(tripId);
    res.status(200).json({ days });
  } catch (error) {
    console.error('Get days error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Block Routes (RBAC applied) ─────────────────────────────────────────────

/**
 * POST /api/trips/:id/blocks
 * Create an activity block. Editors and owners only.
 */
router.post('/:id/blocks', requireRole('owner', 'editor') as RequestHandler, validate(createBlockSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;
    const tripId = req.params.id as string;
    const { dayId, ...blockInput } = req.body;

    const block = await createBlock(dayId, tripId, { ...blockInput, dayId }, userId);
    res.status(201).json({ block });
  } catch (error) {
    console.error('Create block error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Drag-and-Drop Reordering (must be before /:id/blocks/:blockId) ──────────

/**
 * PUT /api/trips/:id/blocks/move
 * Move an activity block to a different day/position. Editors and owners only.
 */
router.put('/:id/blocks/move', requireRole('owner', 'editor') as RequestHandler, validate(moveBlockSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { blockId, targetDayId, targetPosition } = req.body;
    const { userId } = req.auth!;

    const block = await moveBlock(blockId, targetDayId, targetPosition, userId);
    if (!block) {
      res.status(404).json({
        code: 'BLOCK_NOT_FOUND',
        message: 'Activity block not found',
      });
      return;
    }

    res.status(200).json({ block });
  } catch (error) {
    console.error('Move block error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * PUT /api/trips/:id/blocks/reorder
 * Reorder blocks within a day. Editors and owners only.
 */
router.put('/:id/blocks/reorder', requireRole('owner', 'editor') as RequestHandler, validate(reorderBlocksSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { dayId, blockIds } = req.body;

    const blocks = await reorderBlocks(dayId, blockIds);
    res.status(200).json({ blocks });
  } catch (error) {
    console.error('Reorder blocks error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * PUT /api/trips/:id/blocks/:blockId
 * Update an activity block. Editors and owners only.
 */
router.put('/:id/blocks/:blockId', requireRole('owner', 'editor') as RequestHandler, validate(updateBlockSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const blockId = req.params.blockId as string;
    const { userId } = req.auth!;

    const block = await updateBlock(blockId, req.body, userId);
    if (!block) {
      res.status(404).json({
        code: 'BLOCK_NOT_FOUND',
        message: 'Activity block not found',
      });
      return;
    }

    res.status(200).json({ block });
  } catch (error) {
    console.error('Update block error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * DELETE /api/trips/:id/blocks/:blockId
 * Delete an activity block. Editors and owners only.
 */
router.delete('/:id/blocks/:blockId', requireRole('owner', 'editor') as RequestHandler, async (req: Request, res: Response) => {
  try {
    const blockId = req.params.blockId as string;
    const { userId } = req.auth!;

    const block = await deleteBlock(blockId, userId);
    if (!block) {
      res.status(404).json({
        code: 'BLOCK_NOT_FOUND',
        message: 'Activity block not found',
      });
      return;
    }

    res.status(200).json({ message: 'Block deleted successfully' });
  } catch (error) {
    console.error('Delete block error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

// ─── Vote Routes ─────────────────────────────────────────────────────────────

router.use('/:id/votes', tripVoteRoutes);

// ─── Expense Routes ──────────────────────────────────────────────────────────

router.use('/:id/expenses', tripExpenseRoutes);
router.use('/:id/settlements', tripSettlementRoutes);
router.use('/:id/balances', tripBalanceRoutes);

// ─── Activity Feed ───────────────────────────────────────────────────────────

/**
 * GET /api/trips/:id/activity?limit=20&cursor=<lastId>
 * Get the activity feed for a trip. User must be a member.
 *
 * Prefers cursor-based (keyset) pagination: pass `cursor` = the id of the last
 * entry you already have to fetch the next older page. `offset` is still
 * accepted for backward compatibility but is ignored when `cursor` is present.
 * The response includes `nextCursor` (the last entry's id, or null when the
 * page wasn't full) so clients don't have to reach into the list themselves.
 */
router.get('/:id/activity', requireMember() as RequestHandler, async (req: Request, res: Response) => {
  try {
    const tripId = req.params.id as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const cursor = (req.query.cursor as string) || null;

    const activities = await getActivityFeed(tripId, limit, offset, cursor);
    const nextCursor =
      activities.length === limit ? activities[activities.length - 1].id : null;

    res.status(200).json({ activities, nextCursor });
  } catch (error) {
    console.error('Get activity feed error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

export default router;
