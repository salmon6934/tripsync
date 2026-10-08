import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { authenticate, signToken, JWT_SECRET } from './auth.js';

function createMockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function createMockRes() {
  const res: Partial<Response> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: vi.fn().mockReturnThis() as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: vi.fn().mockReturnThis() as any,
  };
  return res;
}

describe('Auth Middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  describe('authenticate', () => {
    it('should reject requests without Authorization header', () => {
      const req = createMockReq();
      const res = createMockRes();

      authenticate(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'AUTH_MISSING_TOKEN' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid Bearer token format', () => {
      const req = createMockReq('InvalidToken');
      const res = createMockRes();

      authenticate(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'AUTH_MISSING_TOKEN' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid JWT', () => {
      const req = createMockReq('Bearer invalid.token.here');
      const res = createMockRes();

      authenticate(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'AUTH_INVALID_TOKEN' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign(
        { userId: '123', email: 'test@test.com' },
        JWT_SECRET,
        { expiresIn: '-1s' } // Already expired
      );
      const req = createMockReq(`Bearer ${token}`);
      const res = createMockRes();

      authenticate(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'AUTH_SESSION_EXPIRED' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept valid tokens and attach auth payload', () => {
      const payload = { userId: 'user-123', email: 'test@example.com' };
      const token = signToken(payload);
      const req = createMockReq(`Bearer ${token}`);
      const res = createMockRes();

      authenticate(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).auth).toMatchObject(payload);
    });
  });

  describe('signToken', () => {
    it('should create a valid JWT with userId and email', () => {
      const payload = { userId: 'user-456', email: 'user@example.com' };
      const token = signToken(payload);

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
    });

    it('should support isGuest claim in token', () => {
      const payload = { userId: 'guest-1', email: 'guest_123@guest.tripsync.local', isGuest: true };
      const token = signToken(payload);

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.isGuest).toBe(true);

      const req = createMockReq(`Bearer ${token}`);
      const res = createMockRes();
      authenticate(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req as any).auth.isGuest).toBe(true);
    });
  });
});
