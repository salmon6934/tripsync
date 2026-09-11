import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRouter from './routes/auth.js';
import tripsRouter from './routes/trips.js';
import votesRouter from './routes/votes.js';
import notificationsRouter from './routes/notifications.js';
import geocodeRouter from './routes/geocode.js';
import nearbyRouter from './routes/nearby.js';
import { initializeSocketServer } from './socket/index.js';
import { setIoInstance } from './socket/io-instance.js';
import { authRateLimiter, apiRateLimiter } from './middleware/rate-limit.js';

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create HTTP server (required for Socket.io to attach)
const httpServer = createServer(app);

// Security headers via Helmet
app.use(helmet());
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// CORS configuration
app.use(
  cors({
    origin: '*',
  })
);

app.use(express.json());

// General API rate limiter
app.use('/api', apiRateLimiter);

// Health check route
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Routes — auth gets stricter rate limiting
app.use('/api/auth', authRateLimiter, authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/votes', votesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/nearby', nearbyRouter);

// Initialize Socket.io with Redis adapter
const io = initializeSocketServer(httpServer, REDIS_URL);
setIoInstance(io);

// Start server using httpServer instead of app.listen
httpServer.listen(PORT, () => {
  console.log(`🚀 TripSync Server running on http://localhost:${PORT}`);
});

export { io };
export default app;
