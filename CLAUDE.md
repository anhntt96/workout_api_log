# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repo is a take-home backend assignment (Everfit): a **Workout Logging API** where coaches log client workouts and query history and personal records (PRs). The brief is `Everfit_Test for Backend Engineer.md` (a Markdown conversion of `Everfit_Test for Backend Engineer.pdf`; both gitignored, local only). Read the `.md` version. `frontend/` holds a React demo UI for the API (see "Frontend conventions").

## Commands

- `docker compose up --build --wait` — UI on :8080, API on :3000 and Postgres 18 on :5433; migrations run on startup.
- `npm run start:dev` — watch mode; needs `DATABASE_URL`, e.g. `docker compose up -d db` then `DATABASE_URL=postgres://workout:workout@localhost:5433/workout npm run start:dev`.
- `npm test` — unit tests (Vitest, `src/**/*.spec.ts`, no database).
- `npm run test:e2e` — e2e tests (`test/**/*.e2e-spec.ts`) against a Testcontainers Postgres 18; Docker must be running.
- `npm run lint` (oxlint, type-aware), `npm run typecheck`, `npm run build`.
- `scripts/demo.sh` — curl walkthrough of every endpoint and error case.
- `cd frontend && npm run dev` — React UI on :5173; proxies `/api` to the API on :3000 (`API_URL` overrides).
- `cd frontend && npm test` — frontend tests (Vitest, jsdom, Testing Library, MSW); `npm run lint`, `npm run typecheck`, `npm run build` and `npm run format:check` work there too.

## Code conventions

- ESM (`"type": "module"`): relative imports end in `.js`; import Decimal as `import { Decimal } from 'decimal.js'`.
- Interfaces and type aliases used in decorated signatures (injected constructor params, controller params) must be `import type` or inline `type` (isolatedModules + emitDecoratorMetadata).
- Layers: controller (Zod pipes) → service (rules) → repository (parameterized SQL only). Pure math and parsing live in `src/domain` and use `decimal.js`, never floats.
- Validation failures throw `RequestValidationError` with field paths; the global filter renders every error as `{ statusCode, code, message, errors?, requestId? }`.
- The implementation plan is `docs/superpowers/plans/2026-10-15-workout-logging-api.md`.

## Frontend conventions (`frontend/`)

- A separate npm package: Vite 8, React 19, Tailwind CSS 4, TanStack Query 5, React Router 7. Relative imports have no extension (bundler resolution), unlike the backend. The plan is `docs/superpowers/plans/2026-10-16-frontend-app.md`.
- The browser only calls same-origin `/api/*` (the Vite proxy in development, nginx in Docker). API calls go through `src/api`: `client.ts` (fetch and `ApiError`), `endpoints.ts`, `queries.ts` (hooks). `src/api/types.ts` mirrors the backend presenters by hand; update it when a response shape changes.
- Pages read the client and display unit with `useActiveSession()`. Filters and the selected exercise live in the URL.
- Logging validation belongs to the API: the form sends what was typed and maps `errors[].field` paths back to the inputs.
- Calendar days are local `YYYY-MM-DD` strings from `src/lib/dates.ts`, never `toISOString().slice(0, 10)`. Tests run in `Asia/Ho_Chi_Minh` with `Date` frozen at 2026-10-16 12:00.
- Styling: a dark zinc theme with a lime accent. Reuse the primitives in `src/components/ui`, and write Tailwind classes out in full (variant maps, no string building).

## Design decisions (ADRs in `docs/adr/`)

Read the ADR Summary sections before touching the data model or API. The ADRs build on each other:

- **0001 – PostgreSQL.** Tables: `workout_entries` (one row per logged exercise session, with per-entry PR summaries `best_weight_kg`, `best_volume_kg`, `best_e1rm_kg` computed at write time), `workout_sets` (child rows, keep original `weight` + `unit` plus normalized `weight_kg`), `exercises`, `muscle_groups`, `exercise_muscle_groups` (configurable exercise → muscle group mapping stored as data). No users table; `user_id` is passed by the caller. `unit` is `TEXT` validated by a unit registry in code (not an enum), so adding a unit needs no migration. Use `NUMERIC` for weights. E1RM uses the Epley formula. The detailed "Option A" section of 0001 is stale (it shows the old per-set denormalized design); the Summary is authoritative.
- **0002 – Dates.** `performed_on` is a `DATE` holding the client's local calendar day; `created_at` is a UTC `TIMESTAMPTZ`. The `date` input is either `YYYY-MM-DD` or an ISO datetime **with an offset**, and the date is read in the offset given, never converted to UTC first. A datetime without an offset returns `400`. Dates more than one day in the future return `400`. History filters use inclusive `from`/`to` on `performed_on`. PR comparison takes explicit date ranges per period (the server never computes "this month"). Same-day ordering is `created_at DESC, id DESC`.
- **0003 – Concurrency/idempotency.** Same-day repeats of an exercise are separate entries (no unique constraint on `(user_id, exercise_id, performed_on)`). An optional `Idempotency-Key` header is stored per entry as `K#0`, `K#1`, … in the existing `UNIQUE (user_id, idempotency_key)` column. The exercise find-or-create parts are superseded by 0004. The ADR is deliberately kept simple for a home assignment.
- **0004 – Exercise catalog.** `exercises` is a fixed catalog seeded by migration. The API never creates exercises. `exerciseName` is the only identifier in requests, matched trimmed and case-insensitive, and the response returns the canonical name. `GET /exercises` lists the catalog. An unknown name returns `400` naming the field (e.g. `entries[2].exerciseName`). Bulk requests are all-or-nothing. Entries store a FK to `exercises.id`.

Cross-cutting: validation errors use one structured error format that names the offending field path.

## Documentation workflow

- ADRs are numbered `docs/adr/NNNN-kebab-title.md`, with Status/Date/Deciders header, a `## Summary` (Decision + Why) up front, then Context, options, details, consequences and "Revisit If". Commits use `docs:` style prefixes, and each ADR goes in its own PR.
- `AI_WORKFLOW.md` is an assignment deliverable (AI-assisted workflow log). It is appended automatically by a `SessionEnd` hook (`.claude/hooks/ai-journal.sh`, registered in `.claude/settings.json`) that summarizes each session with `claude -p`. It needs `jq` and `claude` on PATH. Don't hand-write entries; review and correct the generated ones for accuracy. Hook logs go to `.claude/hooks/ai-journal.log` (gitignored).
