# API & WebSocket Protocol Specification

TripSync uses a hybrid communication pattern:
- **RESTful API** (`/api/*`): For authentication, resource lifecycles, file uploads, paginated lists, and heavier data fetches.
- **WebSocket Protocol** (`Socket.io`): For real-time itinerary block moves, live voting responses, cursor presence, and instant push notifications.

---

## 1. Authentication & Security Headers

### HTTP Authorization Header
All protected REST endpoints require a JSON Web Token (JWT) signed with `NEXTAUTH_SECRET`:
```http
Authorization: Bearer <jwt-token>
```
Unauthenticated requests will receive:
```json
{
  "code": "AUTH_MISSING_TOKEN",
  "message": "Authorization token is required"
}
```

### WebSocket Handshake Authentication
When initializing the Socket.io connection, the client must pass the JWT in the handshake authentication block:
```js
const socket = io(process.env.NEXT_PUBLIC_API_URL, {
  auth: {
    token: "<jwt-token>"
  },
  transports: ["websocket", "polling"]
});
```

---

## 2. Rate Limiting Rules

| Surface | Window | Max Requests | Storage | Exceeded Response Code |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Routes** (`/api/auth/*`) | 15 minutes | 10 requests / IP | Memory | `429 RATE_LIMIT_EXCEEDED` |
| **General API** (`/api/*`) | 1 minute | 120 requests / IP | Memory | `429 RATE_LIMIT_EXCEEDED` |
| **Geocoding Proxy** (`/api/geocode/*`) | 1 minute | 40 requests / IP | Memory | `429 RATE_LIMIT_EXCEEDED` |
| **Nearby Places** (`/api/nearby/*`) | 1 minute | 30 requests / IP | Memory | `429 RATE_LIMIT_EXCEEDED` |
| **Socket Mutations** (`block:*`) | 1 minute | 30 events / user | In-Memory Map | `{ error: "RATE_LIMIT_EXCEEDED" }` |

---

## 3. REST API Endpoints

### 3.1 Authentication (`/api/auth`)

#### `POST /api/auth/signup`
Creates a new user profile with a hashed password and optional preset avatar.
- **Request Body**:
  ```json
  {
    "email": "traveler@example.com",
    "password": "SecurePassword123",
    "name": "Jane Traveler",
    "avatarId": 3
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "user": {
      "id": "c1f7b884-2a6d-4950-8b1e-450f588c78be",
      "email": "traveler@example.com",
      "name": "Jane Traveler",
      "avatarId": 3,
      "createdAt": "2026-10-15T10:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

#### `POST /api/auth/login`
Validates credentials and returns a 7-day bearer token.
- **Request Body**:
  ```json
  {
    "email": "traveler@example.com",
    "password": "SecurePassword123"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "user": {
      "id": "c1f7b884-2a6d-4950-8b1e-450f588c78be",
      "email": "traveler@example.com",
      "name": "Jane Traveler"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

#### `GET /api/auth/me`
Retrieves current authenticated user's profile.
- **Headers**: `Authorization: Bearer <token>`
- **Response (200 OK)**: User profile object.

---

### 3.2 Trips Management (`/api/trips`)

#### `POST /api/trips`
Initializes a new trip, registers creator as `owner`, and sequentially generates `days` rows.
- **Request Body**:
  ```json
  {
    "title": "Goa Beach Retreat",
    "destination": "Goa, India",
    "destinationLat": 15.2993,
    "destinationLng": 74.1240,
    "startDate": "2026-11-10",
    "endDate": "2026-11-14"
  }
  ```
- **Response (201 Created)**: Trip record with auto-generated unique `inviteCode`.

#### `POST /api/trips/join`
Adds authenticated user to a trip via invite code as `editor`.
- **Request Body**: `{ "inviteCode": "TRIP-X9K2" }`
- **Response (200 OK)**: `{ "trip": { ... }, "member": { ... } }`

#### `GET /api/trips/:id`
Retrieves detailed trip summary including days, member list, and activity block lists.
- **Access**: Member of trip (`owner`, `editor`, or `viewer`).

#### `PATCH /api/trips/:id/members/:userId`
Updates member role (`editor` | `viewer`).
- **Access**: `owner` only.
- **Request Body**: `{ "role": "viewer" }`

---

### 3.3 Expenses & Settlements (`/api/trips/:id/expenses`)

#### `POST /api/trips/:id/expenses`
Records an expense and calculates owed/paid splits in integer minor units.
- **Access**: `owner` or `editor`.
- **Request Body (Equal Split)**:
  ```json
  {
    "title": "Group Dinner at Fisherman's Wharf",
    "amountMinor": 450000,
    "currency": "INR",
    "paidBy": "user-uuid-1",
    "splitType": "equal",
    "activityBlockId": "optional-block-uuid"
  }
  ```
- **Request Body (Percentage Split)**:
  ```json
  {
    "title": "Villa Rental",
    "amountMinor": 1200000,
    "currency": "INR",
    "paidBy": "user-uuid-1",
    "splitType": "percentage",
    "percentageSplits": [
      { "userId": "user-uuid-1", "percentage": 50 },
      { "userId": "user-uuid-2", "percentage": 50 }
    ]
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "expense": { "id": "...", "amountMinor": 450000, "currency": "INR", ... },
    "splits": [ ... ]
  }
  ```

#### `GET /api/trips/:id/expenses?limit=20&cursor=<lastExpenseId>`
Keyset-paginated list of non-deleted expenses with their respective splits.

#### `GET /api/trips/:id/settlements`
Calculates group financial summary, recorded payment settlements, and optimal suggested transactions.
- **Response (200 OK)**:
  ```json
  {
    "summary": {
      "totalMinor": 1650000,
      "memberBalances": [
        { "userId": "user-1", "balanceMinor": 825000 },
        { "userId": "user-2", "balanceMinor": -825000 }
      ],
      "settlements": [
        {
          "from": "user-2",
          "to": "user-1",
          "amountMinor": 825000,
          "currency": "INR"
        }
      ]
    },
    "payments": [ ... ]
  }
  ```

#### `POST /api/trips/:id/settlements`
Records a direct peer-to-peer debt repayment.
- **Request Body**:
  ```json
  {
    "fromUserId": "user-2",
    "toUserId": "user-1",
    "amountMinor": 825000,
    "note": "Paid via UPI"
  }
  ```

---

## 4. WebSocket Protocol Specification (Socket.io)

### Room Scopes
- **Trip Room**: `trip:<tripId>` (group collaboration room)
- **User Room**: `user:<userId>` (direct personal notifications)

---

### 4.1 Client-to-Server Events (Emitted by Client)

| Event Name | Payload Shape | Description | Acknowledgment Callback |
| :--- | :--- | :--- | :--- |
| `join:trip` | `tripId: string` | Joins the real-time trip room and registers presence in Redis. | None |
| `leave:trip` | `tripId: string` | Leaves room and removes presence. | None |
| `presence:heartbeat` | `{ tripId: string }` | Refreshes presence TTL (30s) in Redis. | None |
| `presence:editing` | `{ tripId: string, blockId: string \| null }` | Marks which activity block the user is currently editing. | None |
| `presence:cursor` | `{ tripId: string, x: number, y: number }` | Broadcasts live mouse pointer coordinates. | None |
| `block:create` | `CreateBlockInput` | Adds a new activity block to a day column. | `({ ok, block } \| { error, message })` |
| `block:update` | `{ blockId, updatedAt, ...updates }` | Updates block details (enforces Last-Write-Wins). | `({ ok, block } \| { error, message, block })` |
| `block:move` | `{ blockId, targetDayId, targetPosition }` | Reorders or moves a block to a new day. | `({ ok, block } \| { error, message })` |
| `block:delete` | `{ blockId }` | Deletes an activity block and unlinks expenses. | `({ ok, block } \| { error, message })` |
| `vote:cast` | `{ voteId, optionId }` | Submits user vote for an option. | `({ ok, tallies } \| { error })` |

---

### 4.2 Server-to-Client Events (Broadcasted by Server)

| Event Name | Target Room | Payload | Description |
| :--- | :--- | :--- | :--- |
| `presence:join` | `trip:<tripId>` (excluding sender) | `{ userId, userName, avatarId }` | Emitted when a peer joins the trip room. |
| `presence:leave` | `trip:<tripId>` (excluding sender) | `{ userId }` | Emitted when a peer leaves or disconnects. |
| `presence:online-list` | Emitting socket only | `PresenceInfo[]` | Returns all currently active members upon joining. |
| `presence:editing` | `trip:<tripId>` (excluding sender) | `{ userId, blockId }` | Shows which card another user has opened. |
| `block:created` | `trip:<tripId>` (excluding sender) | `{ block, userId }` | Delivers newly created block to collaborators. |
| `block:updated` | `trip:<tripId>` (excluding sender) | `{ block, userId }` | Delivers updated block details. |
| `block:moved` | `trip:<tripId>` (excluding sender) | `{ block, userId }` | Updates card order and day placement. |
| `block:deleted` | `trip:<tripId>` (excluding sender) | `{ blockId, userId }` | Triggers card removal on peer boards. |
| `expense:created` | `trip:<tripId>` | `{ expense, splits, userId }` | Emitted when an expense is added via REST. |
| `expense:settled` | `trip:<tripId>` | `{ settlement, userId }` | Emitted when a settlement payment is logged. |
| `notification:new` | `user:<userId>` | `NotificationRecord` | Dispatches real-time user-specific notification. |
