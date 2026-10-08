import {
  isValidAvatarId,
  pickAvatarIdForSeed,
} from '@tripsync/shared';
import { Router, Request, Response, RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { signupSchema, loginSchema, upgradeGuestSchema, validate } from '../validation/schemas.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { authRateLimiter, guestRateLimiter } from '../middleware/rate-limit.js';

const router = Router();

const SALT_ROUNDS = 12;

/**
 * POST /api/auth/signup
 * Creates a new user account and returns a JWT session.
 */
router.post(
  '/signup',
  authRateLimiter as RequestHandler,
  validate(signupSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { email, password, name, avatarId: requestedAvatarId } = req.body;

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (existingUser.length > 0) {
        res.status(409).json({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
        return;
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Assign a default profile avatar
      const avatarId = isValidAvatarId(requestedAvatarId)
        ? requestedAvatarId
        : pickAvatarIdForSeed(email.toLowerCase());

      // Insert the new user
      const [newUser] = await db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          name,
          passwordHash,
          avatarId,
          isGuest: false,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarId: users.avatarId,
          isGuest: users.isGuest,
          createdAt: users.createdAt,
        });

      // Sign a JWT
      const token = signToken({
        userId: newUser.id,
        email: newUser.email,
        isGuest: newUser.isGuest,
      });

      res.status(201).json({
        user: newUser,
        token,
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * POST /api/auth/login
 * Authenticates a user with email/password and returns a JWT.
 */
router.post(
  '/login',
  authRateLimiter as RequestHandler,
  validate(loginSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      // Find user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      // Generic error message to not reveal if email exists
      if (!user || !user.passwordHash) {
        res.status(401).json({
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      // Compare passwords
      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        res.status(401).json({
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      // Sign a JWT
      const token = signToken({
        userId: user.id,
        email: user.email,
        isGuest: user.isGuest,
      });

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarId: user.avatarId,
          isGuest: user.isGuest,
          createdAt: user.createdAt,
        },
        token,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
);

/**
 * POST /api/auth/guest
 * Generates an anonymous/guest session with a synthetic email.
 */
router.post(
  '/guest',
  guestRateLimiter as RequestHandler,
  async (_req: Request, res: Response) => {
    try {
      const guestNumber = Math.floor(1000 + Math.random() * 9000);
      const guestName = `Guest ${guestNumber}`;
      const syntheticEmail = `guest_${nanoid(12)}@guest.tripsync.local`;
      const avatarId = pickAvatarIdForSeed(syntheticEmail);

      const [newUser] = await db
        .insert(users)
        .values({
          email: syntheticEmail,
          name: guestName,
          avatarId,
          isGuest: true,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarId: users.avatarId,
          isGuest: users.isGuest,
          createdAt: users.createdAt,
        });

      const token = signToken({
        userId: newUser.id,
        email: newUser.email,
        isGuest: true,
      });

      res.status(201).json({
        user: newUser,
        token,
      });
    } catch (error) {
      console.error('Guest creation error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Failed to create guest session',
      });
    }
  }
);

/**
 * POST /api/auth/upgrade
 * Promotes an authenticated guest account to a permanent registered account.
 * Preserves all trips, expenses, blocks, and memberships created as a guest.
 */
router.post(
  '/upgrade',
  authRateLimiter as RequestHandler,
  authenticate,
  validate(upgradeGuestSchema) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { email, password, name, avatarId: requestedAvatarId } = req.body;

      // Find current user
      const [currentUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        res.status(404).json({
          code: 'USER_NOT_FOUND',
          message: 'User account not found',
        });
        return;
      }

      // Check if target email already belongs to a registered user
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (existingUser.length > 0 && existingUser[0].id !== userId) {
        res.status(409).json({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const avatarId = isValidAvatarId(requestedAvatarId)
        ? requestedAvatarId
        : (currentUser.avatarId ?? pickAvatarIdForSeed(email.toLowerCase()));

      const [updatedUser] = await db
        .update(users)
        .set({
          email: email.toLowerCase(),
          name: name || (currentUser.isGuest ? 'Traveler' : currentUser.name),
          passwordHash,
          avatarId,
          isGuest: false,
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarId: users.avatarId,
          isGuest: users.isGuest,
          createdAt: users.createdAt,
        });

      const token = signToken({
        userId: updatedUser.id,
        email: updatedUser.email,
        isGuest: false,
      });

      res.status(200).json({
        user: updatedUser,
        token,
      });
    } catch (error) {
      console.error('Upgrade guest error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Failed to upgrade guest account',
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * For JWT-based auth, logout is handled client-side by deleting the token.
 * This endpoint exists for API completeness and can be extended for token blocklisting.
 */
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth!;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarId: users.avatarId,
        isGuest: users.isGuest,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
});

export default router;
