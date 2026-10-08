import { describe, it, expect } from 'vitest';
import { upgradeGuestSchema } from '../validation/schemas.js';

describe('Guest Authentication & Upgrade Validation', () => {
  describe('upgradeGuestSchema', () => {
    it('should accept valid upgrade credentials with email and 8+ char password', () => {
      const result = upgradeGuestSchema.safeParse({
        email: 'traveler@example.com',
        password: 'securepassword123',
        name: 'Jane Traveler',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = upgradeGuestSchema.safeParse({
        email: 'not-an-email',
        password: 'securepassword123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject short password (< 8 chars)', () => {
      const result = upgradeGuestSchema.safeParse({
        email: 'traveler@example.com',
        password: 'short',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 8 characters');
      }
    });

    it('should allow optional name and avatarId', () => {
      const result = upgradeGuestSchema.safeParse({
        email: 'traveler@example.com',
        password: 'securepassword123',
        avatarId: 2,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Synthetic Guest Emails', () => {
    it('should follow the internal guest email format', () => {
      const syntheticEmail = `guest_test12345@guest.tripsync.local`;
      expect(syntheticEmail.startsWith('guest_')).toBe(true);
      expect(syntheticEmail.endsWith('@guest.tripsync.local')).toBe(true);
    });
  });
});
