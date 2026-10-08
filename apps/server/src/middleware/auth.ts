import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret-change-in-production';

export interface AuthPayload {
  userId: string;
  email: string;
  isGuest?: boolean;
}

// Extend Express Request to include auth info
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * Middleware that validates JWT from the Authorization header.
 * Attaches userId and email to req.auth on success.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'AUTH_MISSING_TOKEN',
      message: 'Authorization token is required',
    });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session has expired. Please log in again.',
      });
      return;
    }
    res.status(401).json({
      code: 'AUTH_INVALID_TOKEN',
      message: 'Invalid authentication token',
    });
  }
}

/**
 * Signs a JWT for the given user.
 */
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export { JWT_SECRET };
