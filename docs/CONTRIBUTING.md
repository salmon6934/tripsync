# Contributing to TripSync

Thank you for your interest in contributing to TripSync! This document outlines our conventions, development workflow, and pull request procedures.

---

## 1. Development Principles

- **End-to-End Type Safety**: Never use `any` unless strictly interfacing with external untyped packages. Share contracts via `@tripsync/shared`.
- **Integer-First Math**: Never perform financial operations or store money using standard floating-point numbers. Always use integer minor units (`amountMinor`).
- **Resilient Sockets**: WebSocket handlers must gracefully validate all inputs via Zod before touching the database or triggering broadcasts.
- **Fail Gracefully**: If secondary features (e.g. notifications, activity logging, or Redis presence updates) fail, they must not crash the primary transaction.

---

## 2. Git Workflow & Branching

We follow standard GitHub flow:
- `main`: Production-ready, stable codebase.
- Branch naming conventions:
  - `feature/<short-description>`: New features or major capabilities
  - `fix/<issue-or-bug>`: Bug fixes
  - `refactor/<module-name>`: Code restructuring without functional changes
  - `docs/<topic>`: Documentation additions or revisions

### Creating a Pull Request
1. Fork and create a branch from `main`:
   ```bash
   git checkout -b feature/offline-sync
   ```
2. Make your commits with clear, descriptive commit messages:
   ```bash
   git commit -m "feat(expenses): add multi-currency exchange rate conversions"
   ```
3. Run linting and test suites before pushing:
   ```bash
   npm run lint
   npm run format:check
   npm run test
   ```
4. Push your branch to GitHub and open a Pull Request targeting `main`.

---

## 3. Monorepo Workflow

TripSync uses npm workspaces:
- Adding a root devDependency:
  ```bash
  npm install -D <package>
  ```
- Adding a dependency to a specific workspace:
  ```bash
  npm install <package> --workspace=@tripsync/server
  npm install <package> --workspace=@tripsync/web
  npm install <package> --workspace=@tripsync/shared
  ```
- Running scripts in a specific workspace:
  ```bash
  npm run build --workspace=packages/shared
  npm run test --workspace=apps/server
  ```

---

## 4. Coding & Style Guidelines

### 4.1 TypeScript & Zod Validation
- Always co-locate schema validation with the endpoint or event payload.
- Derive TypeScript types directly from Zod schemas when possible:
  ```ts
  export const createBlockSchema = z.object({ ... });
  export type CreateBlockInput = z.infer<typeof createBlockSchema>;
  ```

### 4.2 Formatting & Linting
TripSync enforces ESLint and Prettier. To auto-format your changes:
```bash
npm run format
```

### 4.3 Database Schemas
- Never edit existing applied migration files.
- Always use `npm run db:generate` to produce new versioned migrations or `npm run db:push` in local sandbox mode.
- Explicitly add foreign key cascades and index definitions in `schema.ts`.

---

## 5. Reporting Issues

If you discover a bug or have a feature suggestion, please open an Issue on GitHub:
- Provide a clear, descriptive title.
- Detail the exact steps to reproduce the issue.
- Include expected vs actual behavior.
- Attach browser console logs or server stack traces when applicable.
