import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

const mockSet = vi.fn().mockResolvedValue('OK');
const mockGet = vi.fn().mockResolvedValue(null);
const mockDel = vi.fn().mockResolvedValue(1);
const mockExpire = vi.fn().mockResolvedValue(1);
const mockSadd = vi.fn().mockResolvedValue(1);
const mockSrem = vi.fn().mockResolvedValue(1);
const mockSmembers = vi.fn().mockResolvedValue([]);
const mockMget = vi.fn().mockResolvedValue([]);
const mockOn = vi.fn();

const mockRedisClient = {
  set: mockSet,
  get: mockGet,
  del: mockDel,
  expire: mockExpire,
  sadd: mockSadd,
  srem: mockSrem,
  smembers: mockSmembers,
  mget: mockMget,
  on: mockOn,
} as unknown as Redis;

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockRedisClient),
}));

import {
  join,
  leave,
  heartbeat,
  setEditing,
  getOnlineMembers,
  setRedisClient,
} from './presence.service.js';

describe('Presence Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Inject mock client
    setRedisClient(mockRedisClient);
  });

  describe('join', () => {
    it('should SET presence key with JSON payload and TTL, and SADD to members set', async () => {
      await join('trip-1', 'user-1', 'Alice', 3);

      // Verify SET was called with correct key, JSON payload, EX, and 30s TTL
      expect(mockSet).toHaveBeenCalledTimes(1);
      const [key, value, exFlag, ttl] = mockSet.mock.calls[0];
      expect(key).toBe('presence:trip-1:user-1');
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(30);

      const payload = JSON.parse(value);
      expect(payload.userId).toBe('user-1');
      expect(payload.userName).toBe('Alice');
      expect(payload.avatarId).toBe(3);
      expect(payload.editingBlockId).toBeNull();
      expect(payload.lastHeartbeat).toBeDefined();

      // Verify SADD to members set
      expect(mockSadd).toHaveBeenCalledWith('presence:trip-1:members', 'user-1');
    });

    it('should use default values for userName and avatarId when not provided', async () => {
      await join('trip-1', 'user-2');

      const [, value] = mockSet.mock.calls[0];
      const payload = JSON.parse(value);
      expect(payload.userName).toBe('Unknown');
      expect(payload.avatarId).toBeNull();
    });
  });

  describe('leave', () => {
    it('should DEL presence key and SREM from members set', async () => {
      await leave('trip-1', 'user-1');

      expect(mockDel).toHaveBeenCalledWith('presence:trip-1:user-1');
      expect(mockSrem).toHaveBeenCalledWith('presence:trip-1:members', 'user-1');
    });
  });

  describe('heartbeat', () => {
    it('should refresh TTL and update lastHeartbeat when key exists', async () => {
      const existingPayload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: 'block-5',
        lastHeartbeat: '2025-01-01T00:00:00.000Z',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(existingPayload));

      await heartbeat('trip-1', 'user-1');

      expect(mockGet).toHaveBeenCalledWith('presence:trip-1:user-1');
      expect(mockSet).toHaveBeenCalledTimes(1);

      const [key, value, exFlag, ttl] = mockSet.mock.calls[0];
      expect(key).toBe('presence:trip-1:user-1');
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(30);

      const payload = JSON.parse(value);
      // lastHeartbeat should be updated
      expect(payload.lastHeartbeat).not.toBe('2025-01-01T00:00:00.000Z');
      // Other fields should be preserved
      expect(payload.editingBlockId).toBe('block-5');
    });

    it('should call expire when key does not exist (already expired)', async () => {
      mockGet.mockResolvedValueOnce(null);

      await heartbeat('trip-1', 'user-1');

      expect(mockGet).toHaveBeenCalledWith('presence:trip-1:user-1');
      // Falls through to expire on non-existing key
      expect(mockExpire).toHaveBeenCalledWith('presence:trip-1:user-1', 30);
    });
  });

  describe('setEditing', () => {
    it('should update editingBlockId in the presence payload', async () => {
      const existingPayload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: null,
        lastHeartbeat: '2025-01-01T00:00:00.000Z',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(existingPayload));

      await setEditing('trip-1', 'user-1', 'block-42');

      expect(mockGet).toHaveBeenCalledWith('presence:trip-1:user-1');
      expect(mockSet).toHaveBeenCalledTimes(1);

      const [, value] = mockSet.mock.calls[0];
      const payload = JSON.parse(value);
      expect(payload.editingBlockId).toBe('block-42');
    });

    it('should clear editingBlockId when null is passed', async () => {
      const existingPayload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: 'block-42',
        lastHeartbeat: '2025-01-01T00:00:00.000Z',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(existingPayload));

      await setEditing('trip-1', 'user-1', null);

      const [, value] = mockSet.mock.calls[0];
      const payload = JSON.parse(value);
      expect(payload.editingBlockId).toBeNull();
    });

    it('should do nothing if presence key does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);

      await setEditing('trip-1', 'user-1', 'block-1');

      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe('getOnlineMembers', () => {
    it('should return empty array when no members are in the set', async () => {
      mockSmembers.mockResolvedValueOnce([]);

      const result = await getOnlineMembers('trip-1');

      expect(result).toEqual([]);
      expect(mockMget).not.toHaveBeenCalled();
    });

    it('should return presence info for all online members', async () => {
      const user1Payload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: null,
        lastHeartbeat: '2025-01-15T10:00:00.000Z',
      };
      const user2Payload = {
        userId: 'user-2',
        userName: 'Bob',
        avatarId: 5,
        editingBlockId: 'block-3',
        lastHeartbeat: '2025-01-15T10:00:05.000Z',
      };

      mockSmembers.mockResolvedValueOnce(['user-1', 'user-2']);
      mockMget.mockResolvedValueOnce([
        JSON.stringify(user1Payload),
        JSON.stringify(user2Payload),
      ]);

      const result = await getOnlineMembers('trip-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(user1Payload);
      expect(result[1]).toEqual(user2Payload);
      expect(mockMget).toHaveBeenCalledWith(
        'presence:trip-1:user-1',
        'presence:trip-1:user-2'
      );
    });

    it('should clean up stale members whose keys have expired', async () => {
      const user1Payload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: null,
        lastHeartbeat: '2025-01-15T10:00:00.000Z',
      };

      // user-1 has a key, user-2 key has expired (null)
      mockSmembers.mockResolvedValueOnce(['user-1', 'user-2']);
      mockMget.mockResolvedValueOnce([
        JSON.stringify(user1Payload),
        null, // user-2 expired
      ]);

      const result = await getOnlineMembers('trip-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
      // Should clean up stale user-2 from the set
      expect(mockSrem).toHaveBeenCalledWith('presence:trip-1:members', 'user-2');
    });

    it('should clean up multiple stale members', async () => {
      mockSmembers.mockResolvedValueOnce(['user-1', 'user-2', 'user-3']);
      mockMget.mockResolvedValueOnce([null, null, null]);

      const result = await getOnlineMembers('trip-1');

      expect(result).toHaveLength(0);
      expect(mockSrem).toHaveBeenCalledWith(
        'presence:trip-1:members',
        'user-1',
        'user-2',
        'user-3'
      );
    });
  });

  describe('TTL auto-expiry behavior', () => {
    it('should set presence with 30s TTL on join', async () => {
      await join('trip-1', 'user-1', 'Alice');

      const [, , exFlag, ttl] = mockSet.mock.calls[0];
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(30);
    });

    it('should reset TTL to 30s on heartbeat', async () => {
      const existingPayload = {
        userId: 'user-1',
        userName: 'Alice',
        avatarId: null,
        editingBlockId: null,
        lastHeartbeat: '2025-01-01T00:00:00.000Z',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(existingPayload));

      await heartbeat('trip-1', 'user-1');

      const [, , exFlag, ttl] = mockSet.mock.calls[0];
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(30);
    });
  });
});
