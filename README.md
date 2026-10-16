# Workout Logging API

Coaches log their clients' workouts and query history and personal records (PRs). The stack is NestJS 12, PostgreSQL 18 and TypeScript, and `docker compose up` brings it up.

- Bulk logging in `kg` or `lb`, normalized to kg and stored next to the logged values
- History filtered by partial exercise name, muscle group and date range, returned in any unit, with cursor pagination
- PRs (heaviest set, highest-volume set, best Epley 1RM), each with the date it was reached, and a comparison between two periods
- Idempotent retries, all-or-nothing bulk writes, and one structured error format with field paths
- Index-backed reads, proven by a test at 50,000 entries per user

Design decisions are recorded as ADRs in [`docs/adr/`](docs/adr/).

## Quick start

Requires Docker.

```bash
docker compose up --build --wait     # API on http://localhost:3000, Postgres on localhost:5433
scripts/demo.sh                      # walks through every endpoint and error case (needs curl, jq, uuidgen)
```

If port 3000 or 5433 is taken, pick others: `API_PORT=3300 DB_PORT=5544 docker compose up --build --wait`, then `scripts/demo.sh http://localhost:3300`.

```bash
USER_ID=0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e
curl -s -X POST localhost:3000/users/$USER_ID/workout-entries -H 'Content-Type: application/json' \
  -d '{"entries":[{"date":"2026-10-14","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
curl -s "localhost:3000/users/$USER_ID/workout-entries?unit=lb"
curl -s "localhost:3000/users/$USER_ID/personal-records?exerciseName=Bench%20Press"
```

### Local development

Requires Node 24 or later and Docker.

```bash
npm install
docker compose up -d db
DATABASE_URL=postgres://workout:workout@localhost:5433/workout npm run start:dev
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest), no database |
| `npm run test:e2e` | End-to-end tests against a throwaway Postgres 18 (Testcontainers); Docker must be running |
| `npm run lint` / `npm run typecheck` / `npm run build` | oxlint (type-aware), `tsc --noEmit`, production build |

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | (required) | Postgres connection string |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `DB_POOL_MAX` | `10` | Maximum Postgres connections per instance |

Invalid configuration stops the app at startup with a message naming every bad variable.

## Architecture

```mermaid
flowchart LR
  client[Coach app / API client] -->|HTTP + JSON| http
  subgraph app[NestJS API]
    direction TB
    http[pino-http: JSON logs + X-Request-Id<br/>JSON body parser, 1 MB limit] --> controllers
    controllers[Controllers<br/>Zod validation pipes] --> services[Services<br/>business rules]
    services --> repositories[Repositories<br/>parameterized SQL]
    domain[Domain<br/>unit registry · Epley/volume · dates] -.-> services
    filter[Global exception filter<br/>one error format] -.-> controllers
  end
  repositories -->|pg pool| db[(PostgreSQL 18)]
```

```
src/
  domain/            pure, unit-tested: weight-unit registry, set metrics (Epley, volume), ADR 0002 date parsing
  common/            validation pipe + shared schemas, exception filter, request ids, clock
  config/ database/  env validation; pg pool, migration runner, transactions
  exercises/         fixed catalog (GET /exercises) and name / muscle-group lookups
  workouts/          POST + GET workout entries: schemas, service, repository, presenter, cursor, idempotency
  personal-records/  PR lookups and period comparison
  health/            GET /health
migrations/          SQL migrations, applied at startup under an advisory lock
```

Request flow: a controller validates `params`, `query` and `body` with Zod. The service applies the business rules (catalog lookup, future-date limit, idempotency, unit conversion). The repository runs SQL. All weight math uses `decimal.js`, and weights are `NUMERIC` in the database, so there is no float drift. Dependency injection connects the layers, and tests swap the configuration and the clock.

## API

All bodies are JSON. `userId` is any UUID. There is no users table and no authentication, as the brief specifies.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness and database check |
| `GET` | `/exercises` | Exercise catalog with muscle groups |
| `POST` | `/users/{userId}/workout-entries` | Log one or more entries (bulk, all-or-nothing) |
| `GET` | `/users/{userId}/workout-entries` | History: filters, unit conversion, cursor pagination |
| `GET` | `/users/{userId}/personal-records` | PRs for one exercise, all-time or within a date range |
| `GET` | `/users/{userId}/personal-records/comparison` | PRs in one period against a baseline period |

### Log entries: `POST /users/{userId}/workout-entries`

```http
POST /users/0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e/workout-entries
Content-Type: application/json
Idempotency-Key: session-2026-10-14-a

{
  "entries": [
    {
      "date": "2026-10-14",
      "exerciseName": "Bench Press",
      "sets": [{ "reps": 5, "weight": 100, "unit": "kg" }, { "reps": 3, "weight": 105, "unit": "kg" }]
    },
    {
      "date": "2026-10-14T18:30:00+07:00",
      "exerciseName": "back squat",
      "sets": [{ "reps": 5, "weight": 225, "unit": "lb" }]
    }
  ]
}
```

`201 Created`:

```json
{
  "data": [
    {
      "id": "3f2b8c1e-6a4d-4e0f-9b7a-2c5d8e1f4a6b",
      "userId": "0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e",
      "date": "2026-10-14",
      "exerciseName": "Bench Press",
      "sets": [{ "reps": 5, "weight": 100, "unit": "kg" }, { "reps": 3, "weight": 105, "unit": "kg" }],
      "createdAt": "2026-10-15T09:09:08.404114Z"
    },
    {
      "id": "8a1c4e7f-2b5d-4f8a-a3c6-9e0b1d4f7a2c",
      "userId": "0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e",
      "date": "2026-10-14",
      "exerciseName": "Back Squat",
      "sets": [{ "reps": 5, "weight": 225, "unit": "lb" }],
      "createdAt": "2026-10-15T09:09:08.404114Z"
    }
  ]
}
```

Rules:

- Send the body as JSON (`Content-Type: application/json`); any other body is rejected with `Request body must be a JSON object`.
- `entries`: 1–50 items. `sets`: 1–50 per entry. `reps`: an integer, 1–1000. `weight`: 0–5000 (0 for bodyweight). `unit`: `kg` or `lb`, case-insensitive.
- `exerciseName` must name a catalog exercise (`GET /exercises`). Matching trims whitespace and ignores case, and responses use the canonical name ([ADR 0004](docs/adr/0004-predefined-exercise-catalog.md)). Names containing control characters are rejected.
- `date` is `YYYY-MM-DD` or an ISO 8601 datetime with an offset. The day is read in the offset you send, so send your local offset rather than `toISOString()` output. A datetime without an offset is rejected, and so is any day later than tomorrow in UTC ([ADR 0002](docs/adr/0002-workout-date-and-timezone.md)).
- Unknown fields are rejected. The whole request is validated first and every problem is reported at once. Nothing is stored unless every entry is valid.
- Weights are stored with 3 decimals. Each set keeps its logged `weight` and `unit` and also stores `weight_kg`.
- **Idempotency** ([ADR 0003](docs/adr/0003-concurrent-writes-and-idempotency.md)): with an `Idempotency-Key` header (1–200 visible ASCII characters), a retry stores nothing new and returns the original entries with `Idempotent-Replayed: true`. Parallel retries are safe. Keys are scoped to the user. Use a new key for every new request, because a key reused with a different body is not detected: entries at positions already stored come back unchanged, and any extra entries in a longer body are stored. Without a key, every request is stored, including identical ones.

### History: `GET /users/{userId}/workout-entries`

| Query | Meaning |
| --- | --- |
| `exerciseName` | Case-insensitive partial match (`squat` matches Back Squat and Front Squat); `%` and `_` are literal |
| `muscleGroup` | Exact muscle group, case-insensitive (`chest`, `back`, …); an unknown group returns `400` listing the valid ones. Control characters are rejected. |
| `from`, `to` | Inclusive YYYY-MM-DD bounds on the workout day (not before 0001-01-01) |
| `unit` | Convert every set to `kg` or `lb` (2 decimals). A set already in that unit keeps its exact logged value. Omit it to get sets as logged |
| `limit` | Page size, 1–100, default 20 |
| `cursor` | `page.nextCursor` from the previous page |

Results are ordered newest day first, and within a day the most recently logged first (`performed_on DESC, created_at DESC, id DESC`).

```json
{
  "data": [
    {
      "id": "3f2b8c1e-6a4d-4e0f-9b7a-2c5d8e1f4a6b",
      "userId": "0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e",
      "date": "2026-10-14",
      "exerciseName": "Bench Press",
      "sets": [{ "reps": 5, "weight": 220.46, "unit": "lb" }],
      "createdAt": "2026-10-15T09:09:08.404114Z"
    }
  ],
  "page": { "limit": 20, "nextCursor": "WyIyMDI2LTEwLTE0IiwiMjAyNi0xMC0xNVQwOTowOTowOC40MDQxMTRaIiwiM2YyYjhjMWUtNmE0ZC00ZTBmLTliN2EtMmM1ZDhlMWY0YTZiIl0" }
}
```

`page.nextCursor` is `null` on the last page. An empty page returns `200` with `"data": []` and `"message": "No workout entries match the given filters."`.

### Personal records: `GET /users/{userId}/personal-records`

Query: `exerciseName` (required), `unit` (`kg` by default), and optional `from` and `to` (inclusive).

```json
{
  "data": {
    "exerciseName": "Bench Press",
    "unit": "kg",
    "from": null,
    "to": null,
    "records": {
      "maxWeight": { "value": 120, "weight": 120, "reps": 1, "date": "2026-09-02", "entryId": "5d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a" },
      "maxVolume": { "value": 800, "weight": 80, "reps": 10, "date": "2026-09-02", "entryId": "5d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a" },
      "bestE1rm": { "value": 128.33, "weight": 110, "reps": 5, "date": "2026-09-09", "entryId": "9a7c6b5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d" }
    }
  }
}
```

- `maxWeight` is the heaviest single set. `maxVolume` is the set with the highest reps × weight. `bestE1rm` is the best Epley estimate, `weight × (1 + reps / 30)`.
- Each record names the set that achieved it and the day it was first reached. Sets logged in different units are compared by their kilogram value.
- A weight shown in the unit it was logged in is exact (100.125 kg stays 100.125); converted weights, volume and e1RM are rounded to 2 decimals.
- With no entries in scope, all three records are `null` and the response carries a `message`.

### Comparison: `GET /users/{userId}/personal-records/comparison`

Query: `exerciseName`, `from`, `to`, `baselineFrom`, `baselineTo` (all required) and `unit`. The client sends explicit ranges, because "this month" depends on the client's time zone (ADR 0002).

The response has `exerciseName` and `unit`, then `current` and `baseline`. Each of those has its `from` and `to` and a `records` object shaped like the PR endpoint's. `change` gives the difference per metric. For example, October (one set of 3 × 110 kg) against September (5 × 100 kg and 1 × 105 kg):

```json
{
  "change": {
    "maxWeight": { "absolute": 5, "percent": 4.76 },
    "maxVolume": { "absolute": -170, "percent": -34 },
    "bestE1rm": { "absolute": 4.33, "percent": 3.71 }
  }
}
```

A change is `null` when either period has no record for that metric. `percent` is `null` when the baseline value is 0 (bodyweight work). When neither period has data, the response carries a `message`.

### Errors

Every error has the same shape:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "errors": [
    { "field": "entries[0].sets[1].unit", "message": "Unsupported unit \"stone\". Supported units: kg, lb" },
    { "field": "entries[1].date", "message": "date is required" }
  ],
  "requestId": "6a0f7c1e-6d0b-4f4e-9d61-1b8b0a2f5c3d"
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid params, query or body; unknown exercise or muscle group; date in the future; bad cursor or idempotency key. `errors[]` names each field. |
| 400 | `BAD_REQUEST` | Malformed JSON, or a malformed percent-encoded URL |
| 404 | `NOT_FOUND` | Unknown route |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 1 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported body charset |
| 4xx | `HTTP_ERROR` | Any other client error raised by the HTTP layer (message shown only when safe to expose) |
| 503 | `SERVICE_UNAVAILABLE` | `GET /health` when the database is unreachable |
| 500 | `INTERNAL_ERROR` | Anything unexpected; details are logged, never returned |

Shape errors (types, ranges, unknown fields) are reported together first. Catalog and future-date checks run once the shape is valid, and they are also reported together. `requestId` echoes a safe `X-Request-Id` header, or a generated id that also appears in the logs. It is absent when the body could not be parsed, because parsing happens before request logging starts.

## Database

PostgreSQL ([ADR 0001](docs/adr/0001-database-selection.md)). The reasoning: aggregation, filtering and a configurable muscle-group mapping stay simple in SQL, and `CHECK` constraints and foreign keys keep integrity rules in the database as well as in the API.

```mermaid
erDiagram
    exercises ||--o{ workout_entries : "logged as"
    workout_entries ||--|{ workout_sets : "contains (1..n)"
    exercises ||--o{ exercise_muscle_groups : "targets"
    muscle_groups ||--o{ exercise_muscle_groups : "trained by"

    workout_entries {
        uuid id PK "generated by the API"
        uuid user_id "no users table"
        uuid exercise_id FK
        date performed_on "client's calendar day"
        text idempotency_key "UNIQUE (user_id, idempotency_key)"
        numeric best_weight_kg "max weight_kg over sets"
        numeric best_volume_kg "max reps x weight_kg"
        numeric best_e1rm_kg "max Epley 1RM"
        timestamptz created_at "UTC"
    }
    workout_sets {
        uuid entry_id PK, FK
        smallint set_index PK
        int reps "CHECK > 0"
        numeric weight "as logged, CHECK >= 0"
        text unit "validated by the unit registry"
        numeric weight_kg "normalized"
    }
    exercises {
        uuid id PK
        citext name UK
    }
    muscle_groups {
        uuid id PK
        citext name UK
    }
    exercise_muscle_groups {
        uuid exercise_id PK, FK
        uuid muscle_group_id PK, FK
    }
```

| Index | Serves |
| --- | --- |
| `workout_entries (user_id, performed_on DESC, created_at DESC, id DESC)` | History pages; the cursor's row comparison runs inside the index |
| `workout_entries (user_id, exercise_id, performed_on)` | History filtered by exercise; PRs within a date range |
| `workout_entries (user_id, exercise_id, best_<metric>_kg DESC, performed_on)` ×3 | PR lookups: the first index row is the record, and the earliest day wins ties |
| `UNIQUE (user_id, idempotency_key)` | Idempotent retries (`ON CONFLICT DO NOTHING`) |
| `workout_sets PRIMARY KEY (entry_id, set_index)` | Loading an entry's sets |
| `exercises USING gin ((name::text) gin_trgm_ops)` | Partial name search |
| `exercise_muscle_groups (muscle_group_id)` | Muscle group → exercises lookup |

Design notes:

- **Write-time summaries.** Each entry stores its best weight, volume and e1RM. A PR query reads one index row per metric instead of scanning every set. Entries are immutable, so the summaries never go stale. The trade-off is that changing the 1RM formula needs a backfill.
- **Original and normalized weights.** Sets keep `weight` and `unit` as logged plus `weight_kg`, all `NUMERIC` with 3 decimals. Responses convert from the logged value with exact decimal arithmetic, so a 225 lb set requested in lb comes back as exactly 225.
- **Adding a unit** (for example stone) is one line in `src/domain/weight-units.ts`. `unit` is `TEXT` with no enum or CHECK, so no migration is needed.
- **Configurable muscle groups.** The exercise → muscle group mapping is rows in `exercise_muscle_groups`. Changing it changes history filtering for every existing entry at once, with no code change and no backfill. A test pins this.
- **Fixed exercise catalog** ([ADR 0004](docs/adr/0004-predefined-exercise-catalog.md)), so PRs cannot be split by spelling ("Bench Press" vs "bench press").
- **Dates** ([ADR 0002](docs/adr/0002-workout-date-and-timezone.md)): `performed_on` is a `DATE` holding the client's own calendar day, and every instant (`created_at`) is a UTC `TIMESTAMPTZ`. This avoids the trap of storing a UTC timestamp, where a 06:00 Hanoi workout lands on the previous day and can shift into the previous month. The cost is that time of day is not stored.
- **Migrations** are plain SQL files run by a small runner (`src/database/migrate.ts`). It runs each file in a transaction, records it in `schema_migrations`, and takes an advisory lock so that concurrent instances do not race.

## Performance

`test/large-dataset.e2e-spec.ts` seeds 50,000 entries (150,000 sets) for one user and 10,000 for another, then asserts:

- the first and a deep history page are read from `workout_entries_history_idx` with zero rows discarded and at most one page examined, and all-time PR lookups use the three `best_*` indexes;
- filtered history and ranged PR lookups examine fewer than 1,000 rows, and no query sequentially scans `workout_entries` or `workout_sets`; every query runs in under 50 ms server time (EXPLAIN ANALYZE);
- cursor paging over HTTP returns 100 distinct entries per page.

Dropping `workout_entries_history_idx` or `workout_entries_best_weight_idx` makes the test fail; this was checked when the test was written.

Why it stays fast:

- History uses keyset pagination, never `OFFSET`.
- Name and muscle-group filters are resolved to exercise ids on the tiny `exercises` table first.
- Each PR metric is a single index lookup on the write-time summaries. The set that holds the record is then read from that one entry only.

Try it yourself:

```bash
docker compose up --build --wait
docker compose exec -T db psql -U workout -d workout \
  -c "SET seed.user_id = '7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b'" -c "SET seed.entries = 50000" \
  -f - < scripts/seed-large-dataset.sql
time curl -s "localhost:3000/users/7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b/personal-records?exerciseName=Deadlift" > /dev/null
```

## Testing

- **Unit tests** (`src/**/*.spec.ts`) cover the calculations and rules: unit conversion and rounding (including `1.005 → 1.01`, where floats fail), Epley and volume, per-entry summaries, ADR 0002 date parsing (offsets, impossible dates, no offset), the error format (including malformed and oversized JSON), cursors and LIKE escaping.
- **End-to-end tests** (`test/*.e2e-spec.ts`) run the real app against Postgres 18 in Testcontainers. They cover:
  - every endpoint, and every validation rule with its field path;
  - all-or-nothing bulk writes, including a forced constraint failure part-way through;
  - parallel identical retries, and concurrent logs of the same exercise;
  - paging through entries that share a timestamp, literal `%` in filters, and a live mapping change;
  - mixed-unit PRs, period comparisons with a zero baseline, and the 50k-entry performance checks.

## Trade-offs

- **Raw SQL with `pg` instead of an ORM.** Every query is explicit and written with its indexes in mind, at the cost of hand-written row mapping in the repositories.
- **Zod instead of class-validator.** One schema gives both the TypeScript type and the validation, and Zod's issue paths map directly to `entries[2].sets[0].weight`.
- **A small migration runner instead of a framework.** Its whole behaviour is easy to read. At scale it would move to a separate deploy step, or be replaced by a tool such as node-pg-migrate.
- **Entries are immutable.** There is no update or delete, which keeps the write-time summaries correct. Adding edits means recomputing the summary in the same transaction.
- **Idempotency** does not detect a key reused with a different body or a different number of entries, and keys never expire (ADR 0003).
- **Epley for one rep** follows the brief literally (`weight × 1.033`); many apps special-case it to the lifted weight.
- **Entries from one bulk request** share `created_at`, so their order within a day is by id: stable, but not request order.
- **No time of day** is stored (ADR 0002). It can be added later as a nullable `performed_at` without touching `performed_on`.
- **Compose restarts the API on failure** and waits for Postgres over TCP, so a first run on an empty volume cannot race the database's init phase; a permanent startup error (bad credentials) shows up as a restart loop in `docker compose ps`.

## What I would change for 10,000 concurrent coaches

- **Stateless replicas behind a load balancer**, with **PgBouncer** in transaction mode. Ten replicas × `DB_POOL_MAX` would exceed Postgres' connection limit otherwise.
- **Read replicas** for history and PR reads. Writes stay on the primary, and a read-your-writes path is needed right after logging.
- **Run migrations as a deploy step**, not at startup.
- **Hash-partition** `workout_entries` and `workout_sets` by `user_id` once they reach hundreds of millions of rows. Postgres needs the partition key in every primary and unique key, so `user_id` is added to `workout_sets`, the keys become `(user_id, id)` for entries and `(user_id, entry_id, set_index)` for sets, and the sets foreign key becomes `(user_id, entry_id)` referencing `(user_id, id)`. History, idempotency and record lookups already filter by `user_id`, so they prune immediately; the read-back by entry id after a write and the set lookups (which join on `entry_id`) need a `user_id` predicate added to prune too.
- **Cache `GET /exercises`** with `Cache-Control` and an ETag (it only changes with a deploy), and keep the catalog in memory.
- **Authentication and authorization**: take the coach identity from a token and check coach → client access, instead of trusting `userId` in the path. Add per-coach rate limiting.
- **An idempotency key table** with a payload hash (409 on mismatch) and an expiry job (ADR 0003 "Revisit If").
- **Observability**: RED metrics per route, OpenTelemetry tracing through to `pg`, `pg_stat_statements`, and alerts on p99 latency and pool saturation. Logs are already structured JSON with request ids.
- **An OpenAPI document** generated from the Zod schemas (`z.toJSONSchema`) for client SDKs.
