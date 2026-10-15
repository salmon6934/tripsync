# Setup & Deployment Guide

This guide covers running TripSync in local development, running inside containerized environments via Docker, and deploying to cloud production providers.

---

## 1. Local Development Environment

### 1.1 Prerequisites
- **Node.js**: `v22.x LTS` (Node 20+ is minimum supported)
- **npm**: `v10.x` or later
- **Docker & Docker Compose**: Required for local Postgres and Redis

### 1.2 Step-by-Step Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/salmon6934/tripsync.git
   cd tripsync
   ```

2. **Install all workspace dependencies**:
   ```bash
   npm ci
   ```

3. **Spin up local datastores**:
   ```bash
   npm run docker:up
   ```
   Verify running containers:
   ```bash
   docker ps
   ```
   You should see:
   - `tripsync-postgres` on port `5432`
   - `tripsync-redis` on port `6379`

4. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

5. **Initialize Database Schema**:
   ```bash
   npm run db:push --workspace=apps/server
   ```

6. **Start Dev Server**:
   ```bash
   npm run dev
   ```
   This runs both `apps/server` (port 4000) and `apps/web` (port 3000) concurrently via `concurrently`.

---

## 2. Environment Variables Configuration

| Variable | Description | Default / Example | Required In |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection URI | `postgresql://tripsync:tripsync_dev@localhost:5432/tripsync` | Server |
| `REDIS_URL` | Redis connection URI | `redis://localhost:6379` (or `rediss://...` with TLS for Upstash) | Server |
| `PORT` | Express HTTP & Socket.io server port | `4000` | Server |
| `NODE_ENV` | Environment mode | `development` or `production` | All |
| `NEXTAUTH_URL` | Canonical URL of the Next.js web application | `http://localhost:3000` | Web |
| `NEXTAUTH_SECRET` | Secret key used to sign JWTs and session cookies | `dev-secret-change-in-production` | Server & Web |
| `AUTH_TRUST_HOST` | Trust proxy headers for NextAuth | `true` | Web |
| `NEXT_PUBLIC_API_URL` | Public endpoint of the backend Express server | `http://localhost:4000` | Web |
| `CORS_ORIGIN` | Allowed CORS origins for Express and Socket.io | `http://localhost:3000` (comma-separated for multiple) | Server |
| `NOMINATIM_BASE_URL` | OpenStreetMap Nominatim endpoint | `https://nominatim.openstreetmap.org` | Server |
| `GEOCODE_USER_AGENT` | Identifying User-Agent for OSM usage policy | `TripSync/1.0 (contact: your@email.com)` | Server |

---

## 3. Production Container Deployment (Docker)

TripSync includes an optimized multi-stage `Dockerfile`:
- Stage 1 compiles TypeScript monorepo packages (`@tripsync/shared` and `@tripsync/server`).
- Stage 2 copies compiled JS outputs (`dist/`) and installs only production dependencies (`--omit=dev`), creating a minimal footprint container.

### Building & Running Container Locally

```bash
# Build the production Docker image
docker build -t tripsync-server:latest -f Dockerfile .

# Run the container connecting to host networks
docker run -d \
  -p 4000:4000 \
  --name tripsync-server \
  --env-file .env \
  tripsync-server:latest
```

---

## 4. Production Cloud Deployment: Fly.io

TripSync is pre-configured with a `fly.toml` deployment configuration.

### Deploying the Backend (`apps/server`)

1. **Install Fly CLI and Authenticate**:
   ```bash
   fly auth login
   ```

2. **Create the Fly Application**:
   ```bash
   fly apps create tripsync-backend
   ```

3. **Set Secrets on Fly.io**:
   ```bash
   fly secrets set \
     DATABASE_URL="postgresql://user:pass@your-pg-cluster.internal:5432/tripsync" \
     REDIS_URL="rediss://default:pass@your-upstash-redis.upstash.io:6379" \
     NEXTAUTH_SECRET="your-high-entropy-production-secret-64-chars" \
     CORS_ORIGIN="https://tripsync.vercel.app"
   ```

4. **Deploy Application**:
   ```bash
   fly deploy
   ```

5. **Verify Health Check**:
   ```bash
   curl https://tripsync-backend.fly.dev/api/health
   # Expected response: {"status":"ok","timestamp":"..."}
   ```

---

## 5. Deploying the Frontend (`apps/web` on Vercel)

1. Import the repository into [Vercel](https://vercel.com).
2. Set **Root Directory** to `apps/web`.
3. Configure the following Environment Variables in the Vercel Dashboard:
   - `NEXT_PUBLIC_API_URL`: URL of your deployed Fly.io server (e.g. `https://tripsync-backend.fly.dev`)
   - `NEXTAUTH_URL`: Canonical domain of your Vercel site (e.g. `https://tripsync.vercel.app`)
   - `NEXTAUTH_SECRET`: Identical to the secret configured on the Fly.io backend
   - `AUTH_TRUST_HOST`: `true`
4. Deploy the project.
