<p align="center">
  <img src="apps/web/src/app/icon.png" alt="TripSync Logo" width="96" height="96" style="border-radius: 20%;" />
</p>

<h1 align="center">TripSync</h1>

<p align="center">
  <strong>Real-time collaborative workspace for group travel planning, live itinerary co-editing, voting, interactive mapping, and integer-precision expense settlement.</strong>
</p>

<p align="center">
  <a href="https://github.com/salmon6934/tripsync/actions/workflows/c1.yml"><img src="https://img.shields.io/github/actions/workflow/status/salmon6934/tripsync/c1.yml?branch=main&style=flat-square&label=CI" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Node.js-22_LTS-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 22" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis 7" />
  <img src="https://img.shields.io/badge/License-ISC-blue?style=flat-square" alt="License" />
</p>

---

## 🌟 Key Features

- ⚡ **Real-Time Kanban Itinerary Board**: Drag-and-drop itinerary blocks across days powered by `@dnd-kit`, synchronized instantaneously across all active trip participants via **Socket.io** and **Redis Pub/Sub**.
- 📍 **Fractional Indexing Reordering**: Uses float midpoint calculations `(before + after) / 2` to achieve $O(1)$ reorders with zero database row shift amplification.
- 👥 **Live Presence & Heartbeats**: Ephemeral user presence badges and active block editing locks with Redis auto-expiring TTLs (30s) and client heartbeats.
- 💰 **Precision Expense Splitting & Debt Simplification**:
  - Pure integer minor-unit accounting (`paise`/`cents`) eliminating IEEE 754 floating-point drift.
  - Greedy graph settlement algorithm that minimizes mutual group debts to at most $N - 1$ total transactions.
  - Remainder absorption logic for equal, custom, and percentage-based splits.
- 🗳️ **Collaborative Decision Voting**: Create polls, propose activities/accommodations, and tally votes in real time with live socket broadcasts.
- 🗺️ **Integrated Maps & Location Intelligence**: Leaflet-backed interactive maps, OpenStreetMap / Nominatim reverse geocoding with proxy rate-limiting, and nearby attraction lookup.
- 🛡️ **Role-Based Access Control (RBAC)**: Strict role boundaries (`owner`, `editor`, `viewer`) guarding trip resources, invites, and destructive actions.
- 🔒 **End-to-End Type Safety**: Shared TypeScript interfaces, contracts, and Zod schemas across client and server packages.

---

## 🏗️ Architecture Overview

TripSync is structured as an npm workspaces monorepo:

```
tripsync/
├── apps/
│   ├── server/           # Express 5 + Socket.io backend, Drizzle ORM, services
│   └── web/              # Next.js 16 (React 19), Tailwind CSS v4, Lucide & Radix UI
├── packages/
│   └── shared/           # Cross-boundary TS interfaces, constants, avatar catalogs
├── docs/                 # Detailed architectural, API, database, and setup guides
├── docker-compose.yml    # PostgreSQL 16 and Redis 7 local development containers
└── Dockerfile            # Multi-stage production container build
```

```
               ┌──────────────────────────────────────────────┐
               │         Browser / Client (Next.js 16)        │
               │  @dnd-kit Board • Leaflet Map • Socket.io    │
               └──────────────┬──────────────────┬────────────┘
                              │ HTTP REST        │ WebSocket (WSS)
                              ▼                  ▼
               ┌──────────────────────────────────────────────┐
               │        Express 5 + Socket.io Backend         │
               │   JWT / RBAC Middleware • Zod Validation     │
               └──────────────┬──────────────────┬────────────┘
                              │                  │
                Drizzle ORM   ▼                  ▼ Redis Pub/Sub Adapter
               ┌──────────────────────┐   ┌──────────────────────┐
               │    PostgreSQL 16     │   │       Redis 7        │
               │ Persistent Relations │   │ Presence TTL / Cache │
               └──────────────────────┘   └──────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

Ensure you have the following installed locally:
- [Node.js 22 LTS](https://nodejs.org/) (or later)
- [npm](https://www.npmjs.com/) (v10+)
- [Docker & Docker Compose](https://www.docker.com/)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/salmon6934/tripsync.git
cd tripsync
npm ci
```

### 2. Start PostgreSQL & Redis Services

```bash
npm run docker:up
```
*Starts PostgreSQL on `localhost:5432` and Redis on `localhost:6379` with automatic container healthchecks.*

### 3. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Verify that default ports and connection strings match your local environment:
```env
DATABASE_URL=postgresql://tripsync:tripsync_dev@localhost:5432/tripsync
REDIS_URL=redis://localhost:6379
PORT=4000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-change-in-production
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 4. Push Database Schema & Seeds

Push the Drizzle schemas into your local Postgres instance:

```bash
npm run db:push --workspace=apps/server
```

*(Optional) Launch Drizzle Studio to inspect database tables visually:*
```bash
npm run db:studio --workspace=apps/server
```

### 5. Launch Development Servers

Start both frontend and backend concurrently:

```bash
npm run dev
```

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:4000](http://localhost:4000)
- **API Health Check**: [http://localhost:4000/api/health](http://localhost:4000/api/health)

---

## 🧪 Testing, Linting & Formatting

TripSync maintains test suites powered by [Vitest](https://vitest.dev/):

```bash
# Run unit & integration tests
npm run test

# Run ESLint across monorepo workspaces
npm run lint

# Check code formatting with Prettier
npm run format:check

# Auto-fix code formatting
npm run format
```

---

## 📚 Documentation

Detailed technical documentation is maintained in the [`docs/`](./docs) directory:

- 🏛️ [**Architecture & Design**](./docs/ARCHITECTURE.md): System topology, Redis adapter design, state flows, and technical trade-offs.
- 📡 [**API & WebSocket Protocol Specification**](./docs/API.md): Comprehensive REST endpoints catalog, authentication schemas, and Socket.io event signatures.
- 🗄️ [**Database & Schema Reference**](./docs/DATABASE.md): PostgreSQL entities, ER diagram, foreign-key cascades, and composite indexing strategies.
- ⚙️ [**Setup & Deployment Guide**](./docs/SETUP_DEPLOYMENT.md): Step-by-step local setup, Docker deployment, and Fly.io production configuration.
- 🤝 [**Contributing Guidelines**](./docs/CONTRIBUTING.md): Branching model, PR process, code conventions, and developer workflows.

---

## 🛡️ Security

- **Authentication**: Stateless HS256 JWT tokens with automatic expiry checks across REST headers (`Authorization: Bearer <token>`) and Socket.io handshakes (`socket.handshake.auth.token`).
- **HTTP Hardening**: Security headers injected via `helmet()`, cross-origin resource policy enforcement, and CORS filtering.
- **Tiered Rate Limiting**: Dedicated sliding-window limiters for authentication endpoints, geocoding lookups, standard API routes, and socket mutation buffers.
- **Input Sanitization**: Every mutation is strictly enforced by runtime Zod validation schemas prior to database execution.

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
