import { describe, it, expect } from 'vitest';
import { oauthSchema } from '../validation/schemas.js';

describe('OAuth Schema Validation', () => {
  it('should accept valid email with optional name and avatarId', () => {
    const result = oauthSchema.safeParse({
      email: 'traveler@gmail.com',
      name: 'OAuth Traveler',
      avatarId: 3,
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid email without name or avatarId', () => {
    const result = oauthSchema.safeParse({
      email: 'minimal@gmail.com',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email format', () => {
    const result = oauthSchema.safeParse({
      email: 'not-an-email',
      name: 'Some Name',
    });
    expect(result.success).toBe(false);
  });
});
