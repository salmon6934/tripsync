import {
  isValidAvatarId,
  pickAvatarIdForSeed,
} from '@tripsync/shared';
import { Router, Request, Response, RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { signupSchema, loginSchema, validate } from '../validation/schemas.js';
import { authenticate, signToken } from '../middleware/auth.js';

const router = Router();

const SALT_ROUNDS = 12;

/**
 * POST /api/auth/signup
 * Creates a new user account and returns a JWT session.
 */
router.post('/signup', validate(signupSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { email, password, name, avatarId: requestedAvatarId } = req.body;

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
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

    // Assign a default profile avatar. Prefer the one picked in the signup form;
    // otherwise derive a stable one from the email so every account still gets an
    // avatar (e.g. accounts created without going through the form, or OAuth
    // sign-ins that skip the picker).
    //
    // Only the integer id is persisted — the client resolves it to an image via
    // getAvatarSrc(id), so payloads (DB, API, sockets, session cookie) stay small.
    const avatarId = isValidAvatarId(requestedAvatarId)
      ? requestedAvatarId
      : pickAvatarIdForSeed(email.toLowerCase());

    // Insert the new user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
        avatarId,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarId: users.avatarId,
        createdAt: users.createdAt,
      });

    // Sign a JWT
    const token = signToken({ userId: newUser.id, email: newUser.email });

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
});

/**
 * POST /api/auth/login
 * Authenticates a user with email/password and returns a JWT.
 */
router.post('/login', validate(loginSchema) as RequestHandler, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
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
    const token = signToken({ userId: user.id, email: user.email });

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarId: user.avatarId,
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
});

/**
 * POST /api/auth/logout
 * For JWT-based auth, logout is handled client-side by deleting the token.
 * This endpoint exists for API completeness and can be extended for token blocklisting.
 */
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  // JWT logout is client-side (discard token).
  // In production, you could add the token to a blocklist in Redis.
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
