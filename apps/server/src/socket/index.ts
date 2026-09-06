import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as HttpServer } from 'http';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { JWT_SECRET, AuthPayload } from '../middleware/auth.js';
import { registerBlockHandlers } from './blocks.js';
import { registerPresenceHandlers } from './presence.js';
import { registerVoteHandlers } from './votes.js';
import * as presenceService from '../services/presence.service.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

/**
 * Initializes Socket.io server attached to the given HTTP server.
 * Configures Redis adapter for horizontal scaling and JWT auth middleware.
 */
export function initializeSocketServer(
  httpServer: HttpServer,
  redisUrl: string
): SocketIOServer {
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : undefined; // undefined = allow all origins

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins || '*',
      methods: ['GET', 'POST'],
      credentials: !!allowedOrigins, // Only set credentials when origins are explicit
    },
    transports: ['polling', 'websocket'],
  });

  // Setup Redis adapter for pub/sub across multiple server instances
  const pubClient = new Redis(redisUrl);
  const subClient = pubClient.duplicate();

  // Handle Redis connection errors gracefully
  pubClient.on('error', (err) => {
    console.error('Redis pub client error:', err.message);
  });
  subClient.on('error', (err) => {
    console.error('Redis sub client error:', err.message);
  });

  io.adapter(createAdapter(pubClient, subClient));

  // Authentication middleware: validate JWT from handshake auth.token
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('AUTH_MISSING_TOKEN'));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      socket.data.userId = payload.userId;
      socket.data.email = payload.email;
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(new Error('AUTH_SESSION_EXPIRED'));
      }
      return next(new Error('AUTH_INVALID_TOKEN'));
    }
  });

  // Connection handler: room join/leave
  io.on('connection', (socket) => {
    const userId = socket.data.userId;

    // Join user-specific room for personal notifications
    socket.join(`user:${userId}`);

    // Client joins a trip room
    socket.on('join:trip', async (tripId: string) => {
      if (!tripId || typeof tripId !== 'string') {
        return;
      }
      socket.join(`trip:${tripId}`);
      socket.data.tripId = tripId;

      // Fetch user name and avatar from DB for presence
      let userName = socket.data.email || 'Unknown';
      let avatarId: number | null = null;
      try {
        const [user] = await db
          .select({ name: users.name, avatarId: users.avatarId })
          .from(users)
          .where(eq(users.id, userId));
        if (user) {
          userName = user.name;
          avatarId = user.avatarId;
        }
      } catch (err) {
        console.error('Failed to fetch user for presence:', err);
      }

      // Store name on socket data for later use
      socket.data.userName = userName;
      socket.data.avatarId = avatarId;

      // Register presence in Redis
      await presenceService.join(tripId, userId, userName, avatarId);

      // Broadcast join to others in the room
      socket.to(`trip:${tripId}`).emit('presence:join', {
        userId,
        userName,
        avatarId,
      });

      // Send current online list to the joiner
      const onlineMembers = await presenceService.getOnlineMembers(tripId);
      socket.emit('presence:online-list', onlineMembers);
    });

    // Client explicitly leaves a trip room
    socket.on('leave:trip', async (tripId: string) => {
      if (!tripId || typeof tripId !== 'string') {
        return;
      }
      socket.leave(`trip:${tripId}`);

      // Remove presence from Redis and broadcast leave
      await presenceService.leave(tripId, userId);
      socket.to(`trip:${tripId}`).emit('presence:leave', { userId });

      if (socket.data.tripId === tripId) {
        socket.data.tripId = undefined;
      }
    });

    // Register block event handlers for real-time itinerary collaboration
    registerBlockHandlers(io, socket);

    // Register presence event handlers (heartbeat, editing, cursor)
    registerPresenceHandlers(io, socket);

    // Register vote event handlers for real-time polling
    registerVoteHandlers(io, socket);

    // On disconnect, cleanup presence and rooms
    socket.on('disconnect', async () => {
      // Socket.io automatically removes the socket from all rooms on disconnect.
      // Clean up presence in Redis
      const tripId = socket.data.tripId as string | undefined;
      if (tripId) {
        await presenceService.leave(tripId, userId);
        socket.to(`trip:${tripId}`).emit('presence:leave', { userId });
      }
    });
  });

  return io;
}


