import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@tripsync/shared';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: (size: number) => 'abc123xyz0',
}));

// Mock itinerary service
vi.mock('./itinerary.service.js', () => ({
  generateDays: vi.fn().mockResolvedValue([]),
}));

// Mock db
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit, returning: mockReturning }));
const mockOrderBy = vi.fn();
const mockInnerJoin = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockDelete = vi.fn(() => ({ where: mockWhere }));

vi.mock('../db/index.js', () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (...args: any[]) => (mockInsert as any)(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (...args: any[]) => (mockSelect as any)(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (...args: any[]) => (mockUpdate as any)(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: (...args: any[]) => (mockDelete as any)(...args),
  },
}));

vi.mock('../db/schema.js', () => ({
  trips: { id: 'trips.id', inviteCode: 'trips.invite_code', createdAt: 'trips.created_at' },
  tripMembers: { tripId: 'trip_members.trip_id', userId: 'trip_members.user_id', role: 'trip_members.role' },
  users: { id: 'users.id', name: 'users.name', email: 'users.email', avatarId: 'users.avatar_id' },
}));

// Import after mocking
import {
  createTrip,
  getTrip,
  updateTrip,
  deleteTrip,
  joinTrip,
  getMembership,
} from './trip.service.js';

describe('Trip Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTrip', () => {
    it('should create a trip with a generated invite code and add owner membership', async () => {
      const fakeTripId = 'trip-uuid-1';
      const fakeTrip = {
        id: fakeTripId,
        title: 'Beach Trip',
        destination: 'Goa',
        startDate: '2025-03-01',
        endDate: '2025-03-05',
        createdBy: 'user-1',
        inviteCode: 'abc123xyz0',
        createdAt: new Date(),
      };

      // First insert (trip) returns the trip
      mockReturning.mockResolvedValueOnce([fakeTrip]);
      // Second insert (membership) returns nothing needed
      mockReturning.mockResolvedValueOnce([{}]);

      const result = await createTrip('user-1', {
        title: 'Beach Trip',
        destination: 'Goa',
        startDate: new Date('2025-03-01'),
        endDate: new Date('2025-03-05'),
      });

      expect(result).toEqual(fakeTrip);
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTrip', () => {
    it('should return a trip when found', async () => {
      const fakeTrip = { id: 'trip-1', title: 'My Trip' };
      mockFrom.mockReturnValue({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([fakeTrip]) })) });

      const result = await getTrip('trip-1');
      expect(result).toEqual(fakeTrip);
    });

    it('should return null when trip not found', async () => {
      mockFrom.mockReturnValue({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) });

      const result = await getTrip('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('joinTrip', () => {
    it('should return INVITE_CODE_INVALID when invite code does not match any trip', async () => {
      // Trip lookup returns empty
      mockFrom.mockReturnValue({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) });

      const result = await joinTrip('user-2', 'badcode');
      expect(result).toEqual({ error: ErrorCodes.INVITE_CODE_INVALID });
    });

    it('should return MEMBER_ALREADY_EXISTS for duplicate join', async () => {
      const fakeTrip = { id: 'trip-1', inviteCode: 'validcode' };
      const fakeMember = { tripId: 'trip-1', userId: 'user-2', role: 'editor' };

      // First select (find trip by inviteCode)
      mockFrom.mockReturnValueOnce({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([fakeTrip]) })) });
      // Second select (check existing membership)
      mockFrom.mockReturnValueOnce({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([fakeMember]) })) });

      const result = await joinTrip('user-2', 'validcode');
      expect(result).toEqual({ error: ErrorCodes.MEMBER_ALREADY_EXISTS, trip: fakeTrip });
    });

    it('should add user as editor when invite code is valid and no prior membership', async () => {
      const fakeTrip = { id: 'trip-1', inviteCode: 'validcode' };

      // First select (find trip by inviteCode)
      mockFrom.mockReturnValueOnce({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([fakeTrip]) })) });
      // Second select (check existing membership) - empty
      mockFrom.mockReturnValueOnce({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) });
      // Insert membership
      mockReturning.mockResolvedValueOnce([{}]);

      const result = await joinTrip('user-2', 'validcode');
      expect(result).toEqual({ trip: fakeTrip });
      expect(mockInsert).toHaveBeenCalled();
    });
  });
});
