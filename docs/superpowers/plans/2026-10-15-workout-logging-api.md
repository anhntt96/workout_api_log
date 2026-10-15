# Workout Logging API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Everfit Workout Logging API: coaches log client workouts (bulk, mixed units, idempotent), page through history with filters, and query personal records with period comparisons, with good performance at 50,000+ entries per user.

**Architecture:** A NestJS 12 (ESM) app in three feature modules (exercises, workouts, personal-records). Each request goes controller → Zod validation pipe → service → repository, and repositories run parameterized SQL on PostgreSQL 18 through `pg`. Pure domain code (unit registry, Epley/volume metrics, date parsing) lives in `src/domain` and uses `decimal.js`, not floats. Each entry stores its PR summary (best weight, volume, e1RM) when it is written, so PR and history reads are single index scans.

**Tech Stack:** Node 24+, TypeScript 6, NestJS 12 + Express 5, PostgreSQL 18, `pg`, Zod 4, `decimal.js`, `nestjs-pino`, Vitest 4, Testcontainers, oxlint, Docker Compose.

**Spec:** `Everfit_Test for Backend Engineer.md` (the brief, local only and gitignored) plus the ADRs in `docs/adr/`: `0001-database-selection.md` (its Summary is authoritative), `0002-workout-date-and-timezone.md`, `0003-concurrent-writes-and-idempotency.md` and `0004-predefined-exercise-catalog.md`. Read the brief and every ADR Summary before starting.

**Verified before writing this plan:** a throwaway spike checked the framework glue on this machine. Checked: the NestJS 12 scaffold (ESM, Vitest 4, TS 6), constructor DI under Vitest, a Testcontainers `postgres:18-alpine` global setup with `provide`/`inject`, `unnest` bulk inserts with `ON CONFLICT DO NOTHING` under parallel retries, `DATE` returned as a string, the `to_char` microsecond timestamps, every Zod 4 behaviour used below, Express 5 query parsing, body-parser errors reaching the global filter, the `useBodyParser` limit override, `nest build` with `node dist/main.js` under ESM, and `oxlint --type-aware`. The schema, catalog seed and large-dataset seed below were applied to Postgres 18. At 50,000 entries, `EXPLAIN ANALYZE` showed index-only access: a deep keyset page took about 1 ms, and each PR lookup took about 0.2 ms. Every code block in this plan was then assembled into a scratch project, applying the partial edits exactly as written. `npm run typecheck`, `npm run lint` and `npm run build` passed, along with 89 unit tests and 90 e2e tests. `docker compose up --build --wait` met every smoke expectation in Task 13, and `scripts/demo.sh` ran clean. If something fails during execution, suspect a transcription slip or environment drift before suspecting the design.

**Not agent tasks (the user does these):** recording the time estimate before Task 1 starts (deliverable 5), the video walkthrough, and reviewing the hook-generated `AI_WORKFLOW.md` entries.

## Global Constraints

- Node `>=24` (Docker image `node:24-alpine`); TypeScript `^6.0.3` (not 7: ts toolchains and the Nest scaffold target 6); NestJS `^12.1.3` on Express 5; the package is ESM (`"type": "module"`).
- PostgreSQL 18 everywhere: `postgres:18-alpine` in Docker Compose and in Testcontainers.
- Runtime dependencies are exactly `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `decimal.js`, `nestjs-pino`, `pg`, `pino`, `pino-http`, `reflect-metadata`, `rxjs`, `zod`. No ORM: SQL lives in repositories and is always parameterized.
- Relative imports end in `.js` (`import { x } from './x.js'`). Import Decimal as `import { Decimal } from 'decimal.js'`; the default import fails to typecheck under `nodenext`.
- Any interface or type alias used in a decorated signature (an injected constructor parameter, a controller method parameter) must be imported with `import type` or an inline `type` modifier. `isolatedModules` and `emitDecoratorMetadata` are both on. Classes (`ExercisesRepository`, `Pool`) may be imported normally.
- Weights are `NUMERIC` in the database and `Decimal` in code, never JS float arithmetic. Stored weights and metrics keep 3 decimals (`ROUND_HALF_UP`). Responses round to 2 decimals, except that a set returned in the unit it was logged in keeps its exact logged value.
- Epley e1RM is exactly `weight × (1 + reps / 30)` (from the brief), including for 1 rep.
- Units are `kg` and `lb`, defined only in `src/domain/weight-units.ts`. `unit` is stored as `TEXT` with no enum and no CHECK. Input is matched case-insensitively.
- Dates follow ADR 0002. `performed_on DATE` is the client's calendar day. `date` input is `YYYY-MM-DD` or an ISO 8601 datetime with `Z` or `±HH:MM`, read in the offset given. No offset → 400. A day later than the current UTC date + 1 day → 400.
- History ordering is `performed_on DESC, created_at DESC, id DESC`, with keyset cursor pagination. `limit` defaults to 20, max 100. `from`/`to` are inclusive and must be `YYYY-MM-DD`.
- Idempotency follows ADR 0003. The optional `Idempotency-Key` header is stored per entry as `K#0`, `K#1`, … under `UNIQUE (user_id, idempotency_key)`, written with `ON CONFLICT DO NOTHING`. A replay returns 201 with the stored entries and the header `Idempotent-Replayed: true`.
- Exercises follow ADR 0004. The catalog is fixed and seeded by migration. `exerciseName` is matched trimmed and case-insensitively, and responses use the canonical name. An unknown name → 400 naming the field. Bulk writes are all-or-nothing.
- Every error response is `{ statusCode, code, message, errors?: [{ field, message }], requestId? }`, and field paths look like `entries[2].sets[0].weight`.
- Request limits: ≤ 50 entries per request, ≤ 50 sets per entry, `reps` an integer in 1–1000, `weight` 0–5000, JSON body ≤ 1 MB. Request objects are strict: unknown fields and query parameters → 400.
- There is no users table. `userId` is a UUID-shaped path parameter, validated with `z.guid()`, which accepts what Postgres `uuid` accepts.
- Git: work on branch `feat/workout-logging-api` (Task 15 uses its own branch). Use conventional commit prefixes and stage explicit paths only. Never stage `AI_WORKFLOW.md`; a hook rewrites it. Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- At the end of every task, `npm run typecheck`, `npm run lint`, `npm test` and (from Task 5 on) `npm run test:e2e` all pass. The e2e tests need Docker running.

## Review Focus

1. **Paging through entries that share a day and a timestamp** (one bulk request gives every entry the same `performed_on` and `created_at`): every entry must appear exactly once across pages. Pinned in Task 9 ("pages through entries that share a day and a timestamp…").
2. **`%` and `_` in the `exerciseName` filter** must match literally, not as SQL wildcards (`exerciseName=%` must not return everything). Pinned in Task 6 (repository) and Task 9 (HTTP).
3. **Mixed units.** PRs compare sets by kilograms, so 100 kg beats 200 lb. A set requested in the unit it was logged in returns the exact logged number (225 lb stays 225). Pinned in Task 9 (history conversion) and Task 10 ("compares weights across units by their kilogram value").
4. **Zero-weight (bodyweight) baselines in comparisons** must give `percent: null`, never `Infinity` or `NaN` (which would serialize as `null` silently or crash). Pinned in Task 11 (unit and e2e).
5. **Malformed or oversized JSON bodies** must get 400 or 413 in the standard error shape, not a 500. A full-size request (50 × 50, over Express's 100 kB default) must still be accepted. Pinned in Task 4 (filter spec) and Task 7 ("accepts the largest allowed request").

## Decisions Beyond the ADRs (please review)

These fill gaps the ADRs leave open or adjust details of the ADR 0001 Summary. Task 15 updates the ADR 0001 Summary to match, in a separate docs PR.

- **API surface:** `GET /health`, `GET /exercises`, `POST|GET /users/{userId}/workout-entries`, `GET /users/{userId}/personal-records`, `GET /users/{userId}/personal-records/comparison`. Bulk and single logging share one body shape, `{ "entries": [ … ] }`.
- **History `unit`:** when omitted, sets are returned as logged. PR `unit` defaults to `kg`, because records may come from sets logged in different units.
- **Record ties:** a record is dated by the first time it was reached (`performed_on ASC, created_at ASC`).
- **Unknown `muscleGroup`:** 400, listing the valid groups. An `exerciseName` filter is a partial match, so no match gives an empty list, not an error.
- **Schema refinements vs the ADR 0001 Summary:**
  - The history index includes `created_at`, to match ADR 0002's ordering.
  - `workout_sets` uses `PRIMARY KEY (entry_id, set_index)` and has no surrogate id.
  - The `best_*` indexes end with `performed_on`, for the tie rule above.
  - The trigram index is on `(name::text)`, because `citext` has no trigram operator class.
  - `NUMERIC(10,3)` is used for weights.
  - Entry ids are generated in the API (`randomUUID`), so sets can be inserted in the same multi-row statement.
- **Migrations:** a ~40-line SQL-file runner with an advisory lock, run at app startup. There is no migration framework.
- **Validation:** Zod 4 rather than class-validator, because issue paths map directly to the `entries[2].exerciseName` field paths that ADRs 0002 and 0004 require.

## File Structure

```
package.json, package-lock.json, tsconfig.json, tsconfig.build.json, nest-cli.json
vitest.config.ts                unit tests (src/**/*.spec.ts, no database)
vitest.config.e2e.ts            e2e tests (test/**/*.e2e-spec.ts, Testcontainers)
.oxlintrc.json, .prettierrc, .gitignore (modified), .dockerignore, .env.example
Dockerfile, docker-compose.yml, README.md, CLAUDE.md (modified)
migrations/
  0001_create_schema.sql        tables, constraints, indexes
  0002_seed_exercise_catalog.sql   exercises, muscle groups, mapping (data, not code)
scripts/
  seed-large-dataset.sql        50k-entry seed (used by the perf test and for demos)
  demo.sh                       curl walkthrough of every endpoint and error case
src/
  main.ts                       bootstrap: logger, body limit, migrations, listen
  app.module.ts                 module wiring, global exception filter, pino-http
  app.setup.ts                  HTTP setup shared by main.ts and e2e tests
  core.module.ts                global providers: APP_CONFIG, CLOCK
  config/app-config.ts          env → AppConfig (Zod), fail fast
  common/clock.ts               CLOCK token + Clock interface
  common/errors/request-validation.error.ts   RequestValidationError, FieldError
  common/errors/all-exceptions.filter.ts      one error format for everything
  common/validation/field-path.ts             ['entries',2,'date'] → entries[2].date
  common/validation/zod-validation.pipe.ts    Zod → RequestValidationError
  common/validation/schemas.ts                shared Zod schemas (unit, userId, dates, names)
  common/logging/request-id.ts                X-Request-Id handling
  domain/weight-units.ts        unit registry + exact conversion + rounding
  domain/set-metrics.ts         volume, Epley, per-entry summary
  domain/workout-date.ts        ADR 0002 date parsing, future-date limit
  database/migrate.ts           SQL migration runner
  database/database.module.ts   PG_POOL provider, DATE parser, shutdown
  database/transaction.ts       withTransaction helper
  health/health.controller.ts   GET /health
  exercises/                    catalog repository + GET /exercises + LIKE escaping
  workouts/                     POST/GET workout entries: schemas, service, repository, presenter, cursor, idempotency
  personal-records/             PR lookup + comparison: pure record math, schemas, service, repository
test/
  global-setup.ts               one Postgres container per e2e run, migrated once
  helpers/test-app.ts           createTestApp (fixed clock), resetWorkouts, test users
  helpers/requests.ts           logEntries/logOk/entry/set helpers, typed accessors
  *.e2e-spec.ts                 one file per feature
docs/adr/0001-database-selection.md (Task 15)
```

---

### Task 1: Project scaffold and validated configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `.oxlintrc.json`, `.prettierrc`
- Modify: `.gitignore`
- Create: `src/config/app-config.ts`
- Test: `src/config/app-config.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `APP_CONFIG: symbol`, `interface AppConfig { databaseUrl: string; port: number; logLevel: 'fatal'|'error'|'warn'|'info'|'debug'|'trace'|'silent'; dbPoolMax: number }`, `loadConfig(env: Record<string, string | undefined>): AppConfig` (throws `Error('Invalid environment configuration: …')`). Also the npm scripts `build`, `start`, `start:dev`, `start:prod`, `typecheck`, `lint`, `format`, `test`, `test:watch` and `test:e2e`.

- [ ] **Step 1: Create the feature branch**

```bash
git switch main && git pull --ff-only && git switch -c feat/workout-logging-api
```

Skip this if you are already in a worktree or branch made for this plan.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "workout-api-log",
  "version": "0.1.0",
  "description": "Workout Logging API: log client workouts, query history and personal records",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "oxlint --type-aware src/ test/",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts"
  },
  "dependencies": {
    "@nestjs/common": "^12.1.3",
    "@nestjs/core": "^12.1.3",
    "@nestjs/platform-express": "^12.1.3",
    "decimal.js": "^10.6.0",
    "nestjs-pino": "^5.3.1",
    "pg": "^8.23.1",
    "pino": "^10.4.0",
    "pino-http": "^11.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.8",
    "@nestjs/schematics": "^12.0.7",
    "@nestjs/testing": "^12.1.3",
    "@testcontainers/postgresql": "^12.2.1",
    "@types/express": "^5.0.6",
    "@types/node": "^24.19.2",
    "@types/pg": "^8.23.1",
    "@types/supertest": "^7.2.1",
    "oxlint": "^1.88.0",
    "oxlint-tsgolint": "^7.0.2004",
    "prettier": "^3.9.10",
    "supertest": "^7.3.1",
    "typescript": "^6.0.3",
    "vite": "^8.3.4",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 3: Write the TypeScript, Nest CLI, Vitest, lint and format configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "types": ["vitest/globals", "node"]
  },
  "exclude": ["node_modules", "dist"]
}
```

`tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

`nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
```

`.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "rules": {
    "typescript/no-floating-promises": "error"
  },
  "env": {
    "node": true
  }
}
```

`.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 110
}
```

Append to `.gitignore` (keep the existing lines):

```
*.tsbuildinfo
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: creates `package-lock.json` and exits 0. Warnings that install scripts for `fsevents` and `cpu-features` were not run are expected and harmless.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json vitest.config.ts .oxlintrc.json .prettierrc .gitignore
git commit -m "chore: scaffold NestJS 12 project (ESM, Vitest 4, oxlint)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing config test**

`src/config/app-config.spec.ts`:

```ts
import { loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })).toEqual({
      databaseUrl: 'postgres://u:p@localhost:5432/db',
      port: 3000,
      logLevel: 'info',
      dbPoolMax: 10,
    });
  });

  it('parses numeric settings from strings', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      PORT: '8080',
      DB_POOL_MAX: '25',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({ port: 8080, dbPoolMax: 25, logLevel: 'debug' });
  });

  it('fails fast and names every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud' })).toThrow(/DATABASE_URL.*PORT.*LOG_LEVEL/s);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npm test`
Expected: FAIL. Vitest cannot resolve `./app-config.js`.

- [ ] **Step 8: Implement `src/config/app-config.ts`**

```ts
import { z } from 'zod';

/** Injection token for the validated `AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export interface AppConfig {
  databaseUrl: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  dbPoolMax: number;
}

/** Reads configuration from environment variables and fails fast, naming every invalid one. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  const { DATABASE_URL, PORT, LOG_LEVEL, DB_POOL_MAX } = result.data;
  return { databaseUrl: DATABASE_URL, port: PORT, logLevel: LOG_LEVEL, dbPoolMax: DB_POOL_MAX };
}
```

- [ ] **Step 9: Run the tests, typecheck, lint and build**

Run: `npm test && npm run typecheck && npm run lint && npm run build && ls dist/config`
Expected: 3 tests pass; typecheck and lint report nothing; `dist/config` contains `app-config.js`.

- [ ] **Step 10: Commit**

```bash
git add src/config/app-config.ts src/config/app-config.spec.ts
git commit -m "feat: validate environment configuration at startup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain calculations — unit registry and set metrics

**Files:**
- Create: `src/domain/weight-units.ts`, `src/domain/set-metrics.ts`
- Test: `src/domain/weight-units.spec.ts`, `src/domain/set-metrics.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WeightUnit = 'kg' | 'lb'`, `WEIGHT_UNITS: WeightUnit[]`, `STORAGE_DECIMALS = 3`, `DISPLAY_DECIMALS = 2`
  - `isWeightUnit(value: string): value is WeightUnit`
  - `convertWeight(value: Decimal.Value, from: WeightUnit, to: WeightUnit): Decimal` (exact, no rounding)
  - `roundForStorage(value: Decimal): Decimal`, `roundForDisplay(value: Decimal): number`
  - `interface NormalizedSet { reps: number; weightKg: Decimal }`, `interface EntrySummary { bestWeightKg: Decimal; bestVolumeKg: Decimal; bestE1rmKg: Decimal }`
  - `setVolume(reps: number, weight: Decimal.Value): Decimal`, `epleyOneRepMax(reps: number, weight: Decimal.Value): Decimal`, `summarizeSets(sets: readonly NormalizedSet[]): EntrySummary`

- [ ] **Step 1: Write the failing unit-registry test**

`src/domain/weight-units.spec.ts`:

```ts
import { Decimal } from 'decimal.js';
import { WEIGHT_UNITS, convertWeight, isWeightUnit, roundForDisplay, roundForStorage } from './weight-units.js';

describe('weight units', () => {
  it('lists the supported units', () => {
    expect(WEIGHT_UNITS).toEqual(['kg', 'lb']);
  });

  it.each(['kg', 'lb'])('accepts %s', (unit) => {
    expect(isWeightUnit(unit)).toBe(true);
  });

  // 'toString' and '__proto__' catch a lookup that walks the prototype chain.
  it.each(['KG', 'stone', '', 'toString', '__proto__'])('rejects %j', (unit) => {
    expect(isWeightUnit(unit)).toBe(false);
  });

  it('converts pounds to kilograms with the exact factor', () => {
    expect(convertWeight(100, 'lb', 'kg').toString()).toBe('45.359237');
  });

  it('converts kilograms to pounds', () => {
    expect(roundForDisplay(convertWeight(100, 'kg', 'lb'))).toBe(220.46);
  });

  it('returns the value unchanged for the same unit', () => {
    expect(convertWeight('102.125', 'lb', 'lb').toString()).toBe('102.125');
  });

  it('rounds half up: 3 decimals for storage, 2 for display', () => {
    expect(roundForStorage(new Decimal('45.3595')).toFixed(3)).toBe('45.360');
    expect(roundForStorage(new Decimal('45.3594')).toFixed(3)).toBe('45.359');
    // Float arithmetic would give 1.00 here; exact decimals give 1.01.
    expect(roundForDisplay(new Decimal('1.005'))).toBe(1.01);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/domain/weight-units.spec.ts`
Expected: FAIL. `./weight-units.js` cannot be resolved.

- [ ] **Step 3: Implement `src/domain/weight-units.ts`**

```ts
import { Decimal } from 'decimal.js';

/**
 * Supported weight units and the exact number of kilograms in one unit.
 * Adding a unit (for example `st: '6.35029318'`) is a one-line change here: validation,
 * conversion and responses all read this table, and the database stores `unit` as TEXT,
 * so no migration is needed. Never remove a unit that has already been stored.
 */
const KG_PER_UNIT = {
  kg: '1',
  lb: '0.45359237',
} as const;

export type WeightUnit = keyof typeof KG_PER_UNIT;

export const WEIGHT_UNITS = Object.keys(KG_PER_UNIT) as WeightUnit[];

/** Stored weights and metrics keep gram precision. */
export const STORAGE_DECIMALS = 3;
/** Weights and metrics in responses are rounded to two decimals. */
export const DISPLAY_DECIMALS = 2;

export function isWeightUnit(value: string): value is WeightUnit {
  return Object.hasOwn(KG_PER_UNIT, value);
}

/** Converts a weight between units with exact decimal arithmetic (no rounding). */
export function convertWeight(value: Decimal.Value, from: WeightUnit, to: WeightUnit): Decimal {
  const weight = new Decimal(value);
  if (from === to) return weight;
  return weight.times(KG_PER_UNIT[from]).div(KG_PER_UNIT[to]);
}

export function roundForStorage(value: Decimal): Decimal {
  return value.toDecimalPlaces(STORAGE_DECIMALS, Decimal.ROUND_HALF_UP);
}

export function roundForDisplay(value: Decimal): number {
  return value.toDecimalPlaces(DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/domain/weight-units.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Write the failing set-metrics test**

`src/domain/set-metrics.spec.ts`:

```ts
import { Decimal } from 'decimal.js';
import { epleyOneRepMax, setVolume, summarizeSets } from './set-metrics.js';

const kg = (value: string | number) => new Decimal(value);

describe('setVolume', () => {
  it('multiplies reps by weight', () => {
    expect(setVolume(10, 60).toString()).toBe('600');
  });
});

describe('epleyOneRepMax', () => {
  it('applies weight × (1 + reps / 30)', () => {
    expect(epleyOneRepMax(5, 100).toFixed(3)).toBe('116.667');
    expect(epleyOneRepMax(30, 50).toString()).toBe('100');
  });

  it('follows the brief for a single rep (3.3% above the lifted weight)', () => {
    expect(epleyOneRepMax(1, 120).toFixed(3)).toBe('124.000');
  });

  it('is zero for bodyweight sets logged with zero weight', () => {
    expect(epleyOneRepMax(12, 0).isZero()).toBe(true);
  });
});

describe('summarizeSets', () => {
  it('takes each metric from whichever set maximizes it', () => {
    const summary = summarizeSets([
      { reps: 1, weightKg: kg(120) }, // heaviest (e1RM 124)
      { reps: 10, weightKg: kg(80) }, // most volume: 800
      { reps: 5, weightKg: kg(110) }, // best e1RM: 128.333
    ]);
    expect(summary.bestWeightKg.toFixed(3)).toBe('120.000');
    expect(summary.bestVolumeKg.toFixed(3)).toBe('800.000');
    expect(summary.bestE1rmKg.toFixed(3)).toBe('128.333');
  });

  it('rounds to storage precision', () => {
    // 45.359 × (1 + 7/30) = 55.94276…
    expect(summarizeSets([{ reps: 7, weightKg: kg('45.359') }]).bestE1rmKg.toString()).toBe('55.943');
  });

  it('rejects an entry without sets', () => {
    expect(() => summarizeSets([])).toThrow('Cannot summarize an entry without sets');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- src/domain/set-metrics.spec.ts`
Expected: FAIL. `./set-metrics.js` cannot be resolved.

- [ ] **Step 7: Implement `src/domain/set-metrics.ts`**

```ts
import { Decimal } from 'decimal.js';
import { roundForStorage } from './weight-units.js';

/** A logged set with its weight normalized to kilograms. */
export interface NormalizedSet {
  reps: number;
  weightKg: Decimal;
}

/** Per-entry PR summary stored on `workout_entries` (ADR 0001), at storage precision. */
export interface EntrySummary {
  bestWeightKg: Decimal;
  bestVolumeKg: Decimal;
  bestE1rmKg: Decimal;
}

/** Volume of one set: reps × weight. */
export function setVolume(reps: number, weight: Decimal.Value): Decimal {
  return new Decimal(weight).times(reps);
}

/**
 * Estimated one-rep max with the Epley formula exactly as the brief defines it:
 * weight × (1 + reps / 30). A single rep therefore gives weight × 1.0333.
 */
export function epleyOneRepMax(reps: number, weight: Decimal.Value): Decimal {
  return new Decimal(weight).times(new Decimal(reps).div(30).plus(1));
}

/** The best value of each metric across an entry's sets; the metrics may come from different sets. */
export function summarizeSets(sets: readonly NormalizedSet[]): EntrySummary {
  if (sets.length === 0) {
    throw new Error('Cannot summarize an entry without sets');
  }
  const best = (values: Decimal[]): Decimal => roundForStorage(Decimal.max(...values));
  return {
    bestWeightKg: best(sets.map((set) => set.weightKg)),
    bestVolumeKg: best(sets.map((set) => setVolume(set.reps, set.weightKg))),
    bestE1rmKg: best(sets.map((set) => epleyOneRepMax(set.reps, set.weightKg))),
  };
}
```

- [ ] **Step 8: Run all unit tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/domain/weight-units.ts src/domain/weight-units.spec.ts src/domain/set-metrics.ts src/domain/set-metrics.spec.ts
git commit -m "feat: add weight unit registry and Epley/volume set metrics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Workout date parsing (ADR 0002) and the clock

**Files:**
- Create: `src/domain/workout-date.ts`, `src/common/clock.ts`
- Test: `src/domain/workout-date.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WorkoutDateResult = { ok: true; date: string } | { ok: false; message: string }`
  - `isCalendarDate(value: string): boolean`
  - `parseWorkoutDate(input: string): WorkoutDateResult`. Input is already trimmed; the result `date` is `YYYY-MM-DD`.
  - `latestAllowedWorkoutDate(now: Date): string` (UTC date + 1 day, `YYYY-MM-DD`)
  - `CLOCK: symbol`, `interface Clock { now(): Date }`, `systemClock: Clock`

- [ ] **Step 1: Write the failing test**

`src/domain/workout-date.spec.ts`:

```ts
import { isCalendarDate, latestAllowedWorkoutDate, parseWorkoutDate } from './workout-date.js';

describe('parseWorkoutDate', () => {
  it.each([
    ['2026-10-14', '2026-10-14'],
    ['2026-10-14T06:00:00+07:00', '2026-10-14'], // Hanoi morning stays on the 14th (UTC is the 13th)
    ['2026-10-13T23:00:00Z', '2026-10-13'], // Z means the client chose UTC
    ['2026-10-14T23:30:00-05:00', '2026-10-14'], // New York evening stays on the 14th (UTC is the 15th)
    ['2026-10-14T06:00+07:00', '2026-10-14'], // seconds are optional
    ['2026-10-14T06:00:00.123456+14:00', '2026-10-14'],
    ['2024-02-29', '2024-02-29'],
  ])('reads %s as %s', (input, expected) => {
    expect(parseWorkoutDate(input)).toEqual({ ok: true, date: expected });
  });

  it('rejects a datetime without an offset as ambiguous', () => {
    expect(parseWorkoutDate('2026-10-14T06:00:00')).toEqual({
      ok: false,
      message:
        'datetime must include a UTC offset, e.g. 2026-10-14T06:00:00+07:00, or be a plain date (YYYY-MM-DD)',
    });
  });

  it('names an impossible calendar date', () => {
    expect(parseWorkoutDate('2026-02-30')).toEqual({
      ok: false,
      message: '"2026-02-30" is not a valid calendar date',
    });
  });

  it.each([
    '2025-02-29',
    '2026-13-01',
    '2026-10-14T24:00:00Z',
    '2026-10-14T06:60:00Z',
    '2026-10-14T06:00:00+15:00',
    '2026-02-30T06:00:00Z',
  ])('rejects impossible value %s', (input) => {
    expect(parseWorkoutDate(input).ok).toBe(false);
  });

  it.each(['14/10/2026', '2026-1-4', '', 'yesterday', '2026-10-14 06:00:00+07:00', '2026-10-14T06:00:00+0700'])(
    'rejects unsupported format %j',
    (input) => {
      expect(parseWorkoutDate(input)).toEqual({
        ok: false,
        message: 'date must be YYYY-MM-DD or an ISO 8601 datetime with an offset',
      });
    },
  );
});

describe('isCalendarDate', () => {
  it('accepts only a real YYYY-MM-DD day', () => {
    expect(isCalendarDate('2026-10-14')).toBe(true);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-10-14T00:00:00Z')).toBe(false);
  });
});

describe('latestAllowedWorkoutDate', () => {
  it('is the day after the current UTC date', () => {
    expect(latestAllowedWorkoutDate(new Date('2026-10-15T12:00:00Z'))).toBe('2026-10-16');
  });

  it('uses the UTC date, not the server time zone', () => {
    // 2026-10-15T23:59:59-05:00 is 2026-10-16T04:59:59Z.
    expect(latestAllowedWorkoutDate(new Date('2026-10-15T23:59:59-05:00'))).toBe('2026-10-17');
  });

  it('rolls over month and year ends', () => {
    expect(latestAllowedWorkoutDate(new Date('2026-12-31T08:00:00Z'))).toBe('2027-01-01');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/domain/workout-date.spec.ts`
Expected: FAIL. `./workout-date.js` cannot be resolved.

- [ ] **Step 3: Implement `src/domain/workout-date.ts`**

```ts
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;
const DATETIME_WITHOUT_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

export type WorkoutDateResult = { ok: true; date: string } | { ok: false; message: string };

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = PLAIN_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Reads the workout day from a `date` input (ADR 0002):
 * - `YYYY-MM-DD` is used as is.
 * - An ISO 8601 datetime with an offset (`Z` or `±HH:MM`) gives the calendar day in that
 *   offset, which is the string's date part. It is never converted to UTC first.
 * - A datetime without an offset is ambiguous and rejected.
 */
export function parseWorkoutDate(input: string): WorkoutDateResult {
  if (PLAIN_DATE.test(input)) {
    return isCalendarDate(input) ? { ok: true, date: input } : invalid(`"${input}" is not a valid calendar date`);
  }
  const match = DATETIME_WITH_OFFSET.exec(input);
  if (match) {
    const [, day, hours, minutes, seconds = '00', , offsetHours = '00', offsetMinutes = '00'] = match;
    const validTime = Number(hours) <= 23 && Number(minutes) <= 59 && Number(seconds) <= 59;
    const validOffset = Number(offsetHours) <= 14 && Number(offsetMinutes) <= 59;
    if (isCalendarDate(day) && validTime && validOffset) return { ok: true, date: day };
    return invalid(`"${input}" is not a valid ISO 8601 datetime`);
  }
  if (DATETIME_WITHOUT_OFFSET.test(input)) {
    return invalid(
      'datetime must include a UTC offset, e.g. 2026-10-14T06:00:00+07:00, or be a plain date (YYYY-MM-DD)',
    );
  }
  return invalid('date must be YYYY-MM-DD or an ISO 8601 datetime with an offset');
}

/**
 * The latest accepted workout day: one day after the current UTC date. The slack lets
 * clients in time zones ahead of UTC log their "today" (ADR 0002).
 */
export function latestAllowedWorkoutDate(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function invalid(message: string): WorkoutDateResult {
  return { ok: false, message };
}
```

- [ ] **Step 4: Implement `src/common/clock.ts`**

```ts
/** Injection token for the `Clock`. */
export const CLOCK = Symbol('CLOCK');

/** Source of the current time; injected so tests can pin "today". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/domain/workout-date.ts src/domain/workout-date.spec.ts src/common/clock.ts
git commit -m "feat: parse workout dates in the client's offset (ADR 0002)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Validation pipe, shared schemas and one error format

**Files:**
- Create: `src/common/errors/request-validation.error.ts`, `src/common/validation/field-path.ts`, `src/common/validation/zod-validation.pipe.ts`, `src/common/validation/schemas.ts`, `src/common/errors/all-exceptions.filter.ts`
- Test: `src/common/validation/field-path.spec.ts`, `src/common/validation/zod-validation.pipe.spec.ts`, `src/common/validation/schemas.spec.ts`, `src/common/errors/all-exceptions.filter.spec.ts`

**Interfaces:**
- Consumes: `isWeightUnit`, `WEIGHT_UNITS`, `WeightUnit` (Task 2).
- Produces:
  - `interface FieldError { field: string; message: string }`, `class RequestValidationError extends Error { readonly errors: FieldError[] }` (message `'Request validation failed'`)
  - `formatFieldPath(path: readonly PropertyKey[]): string`
  - `class ZodValidationPipe<T extends z.ZodType>`, used as `new ZodValidationPipe(schema)` in `@Body/@Query/@Param`
  - `requiredError(field: string, expected: string)`, which returns a Zod `{ error }` option
  - `userIdParamSchema`, `plainDateSchema(field: string)`, `exerciseNameSchema(field?: string)`, `weightUnitSchema` (output `WeightUnit`)
  - `class AllExceptionsFilter`, `interface ErrorResponseBody { statusCode; code; message; errors?; requestId? }`. Codes: `VALIDATION_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, `HTTP_ERROR`.

- [ ] **Step 1: Write the failing field-path and pipe tests**

`src/common/validation/field-path.spec.ts`:

```ts
import { formatFieldPath } from './field-path.js';

describe('formatFieldPath', () => {
  it('joins keys with dots and indexes with brackets', () => {
    expect(formatFieldPath(['entries', 2, 'sets', 0, 'weight'])).toBe('entries[2].sets[0].weight');
  });

  it('returns a single key unchanged', () => {
    expect(formatFieldPath(['exerciseName'])).toBe('exerciseName');
  });

  it('returns an empty string for the root', () => {
    expect(formatFieldPath([])).toBe('');
  });
});
```

`src/common/validation/zod-validation.pipe.spec.ts`:

```ts
import { z } from 'zod';
import { type FieldError, RequestValidationError } from '../errors/request-validation.error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.strictObject({
  entries: z.array(z.strictObject({ reps: z.number().min(1, 'reps must be at least 1') })),
});

function validationErrors(run: () => unknown): FieldError[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RequestValidationError);
    return (error as RequestValidationError).errors;
  }
  throw new Error('expected a RequestValidationError');
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value', () => {
    expect(pipe.transform({ entries: [{ reps: 5 }] }, { type: 'body' })).toEqual({ entries: [{ reps: 5 }] });
  });

  it('reports every issue with its field path', () => {
    const errors = validationErrors(() =>
      pipe.transform({ entries: [{ reps: 5 }, { reps: 0 }, { reps: -1 }] }, { type: 'body' }),
    );
    expect(errors).toEqual([
      { field: 'entries[1].reps', message: 'reps must be at least 1' },
      { field: 'entries[2].reps', message: 'reps must be at least 1' },
    ]);
  });

  it('names a route parameter after the parameter', () => {
    const uuidPipe = new ZodValidationPipe(z.guid({ error: 'userId must be a UUID' }));
    expect(validationErrors(() => uuidPipe.transform('abc', { type: 'param', data: 'userId' }))).toEqual([
      { field: 'userId', message: 'userId must be a UUID' },
    ]);
  });

  it('reports a problem with the whole body as "body"', () => {
    expect(validationErrors(() => pipe.transform({ entries: [], extra: true }, { type: 'body' }))).toEqual([
      { field: 'body', message: 'Unrecognized key: "extra"' },
    ]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/common/validation`
Expected: FAIL. `./field-path.js` and `../errors/request-validation.error.js` cannot be resolved.

- [ ] **Step 3: Implement the error type, the path formatter and the pipe**

`src/common/errors/request-validation.error.ts`:

```ts
export interface FieldError {
  /** Path of the offending input, e.g. `entries[2].exerciseName`. */
  field: string;
  message: string;
}

/** A 400 for one or more invalid inputs; the exception filter renders it in the standard error format. */
export class RequestValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}
```

`src/common/validation/field-path.ts`:

```ts
/** Formats a validation path like ['entries', 2, 'sets', 0, 'weight'] as `entries[2].sets[0].weight`. */
export function formatFieldPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    const key = String(segment);
    return formatted === '' ? key : `${formatted}.${key}`;
  }, '');
}
```

`src/common/validation/zod-validation.pipe.ts`:

```ts
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { RequestValidationError } from '../errors/request-validation.error.js';
import { formatFieldPath } from './field-path.js';

/**
 * Validates one controller argument with a Zod schema and returns the parsed output.
 * Field paths are relative to the argument: `entries[0].date` for a body, `limit` for a
 * query object. Issues with the argument as a whole are reported under its name
 * (`userId`) or its kind (`body`, `query`).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const argumentName = metadata.data ?? metadata.type;
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? formatFieldPath(issue.path) : argumentName,
        message: issue.message,
      })),
    );
  }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npm test -- src/common/validation`
Expected: PASS.

- [ ] **Step 5: Write the failing shared-schema test**

`src/common/validation/schemas.spec.ts`:

```ts
import type { z } from 'zod';
import { exerciseNameSchema, plainDateSchema, userIdParamSchema, weightUnitSchema } from './schemas.js';

function messages(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('shared schemas', () => {
  it('normalizes units case-insensitively and lists supported units on error', () => {
    expect(weightUnitSchema.parse(' LB ')).toBe('lb');
    expect(messages(weightUnitSchema, 'stone')).toEqual(['Unsupported unit "stone". Supported units: kg, lb']);
    expect(messages(weightUnitSchema, null)).toEqual(['unit is required']);
    expect(messages(weightUnitSchema, 5)).toEqual(['unit must be a string']);
  });

  it('accepts any UUID-shaped user id, as Postgres does', () => {
    expect(userIdParamSchema.parse('11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(messages(userIdParamSchema, 'coach-42')).toEqual(['userId must be a UUID']);
  });

  it('validates calendar dates and names the field', () => {
    expect(plainDateSchema('from').parse('2026-10-01')).toBe('2026-10-01');
    expect(messages(plainDateSchema('from'), '2026-02-30')).toEqual(['from must be a date in YYYY-MM-DD format']);
    expect(messages(plainDateSchema('from'), undefined)).toEqual(['from is required']);
  });

  it('trims exercise names and rejects blank ones', () => {
    expect(exerciseNameSchema().parse('  Bench Press ')).toBe('Bench Press');
    expect(messages(exerciseNameSchema(), '   ')).toEqual(['exerciseName must not be empty']);
    expect(messages(exerciseNameSchema(), undefined)).toEqual(['exerciseName is required']);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- src/common/validation/schemas.spec.ts`
Expected: FAIL. `./schemas.js` cannot be resolved.

- [ ] **Step 7: Implement `src/common/validation/schemas.ts`**

```ts
import { z } from 'zod';
import { WEIGHT_UNITS, type WeightUnit, isWeightUnit } from '../../domain/weight-units.js';

/** Zod error option: "<field> is required" when missing or null, "<field> must be <expected>" otherwise. */
export function requiredError(field: string, expected: string) {
  return {
    error: (issue: { input?: unknown }) =>
      issue.input === undefined || issue.input === null ? `${field} is required` : `${field} must be ${expected}`,
  };
}

/** Any UUID-shaped id (8-4-4-4-12 hex), the same set Postgres `uuid` accepts. */
export const userIdParamSchema = z.guid({ error: 'userId must be a UUID' });

/** A real calendar day in YYYY-MM-DD form. */
export function plainDateSchema(field: string) {
  return z.iso.date(requiredError(field, 'a date in YYYY-MM-DD format'));
}

export function exerciseNameSchema(field = 'exerciseName') {
  return z
    .string(requiredError(field, 'a string'))
    .trim()
    .min(1, `${field} must not be empty`)
    .max(100, `${field} must be at most 100 characters`);
}

/** A unit from the weight-unit registry, matched case-insensitively. */
export const weightUnitSchema = z
  .string(requiredError('unit', 'a string'))
  .trim()
  .toLowerCase()
  .transform((value, ctx): WeightUnit => {
    if (isWeightUnit(value)) return value;
    ctx.addIssue({
      code: 'custom',
      message: `Unsupported unit "${value}". Supported units: ${WEIGHT_UNITS.join(', ')}`,
    });
    return z.NEVER;
  });
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npm test -- src/common/validation/schemas.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/common/errors/request-validation.error.ts src/common/validation
git commit -m "feat: add Zod validation pipe with field-path errors and shared schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Write the failing exception-filter test**

This test boots a small Nest app with a probe controller and no database. It checks real Express behaviour, including body-parser failures, which reach the filter as plain errors and not `HttpException`s.

`src/common/errors/all-exceptions.filter.spec.ts`:

```ts
import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { RequestValidationError } from './request-validation.error.js';

@Controller('probe')
class ProbeController {
  @Get('validation')
  validation(): never {
    throw new RequestValidationError([{ field: 'entries[0].date', message: 'date is required' }]);
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('Nothing here');
  }

  @Get('crash')
  crash(): never {
    throw new Error('connection refused: password=secret');
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('AllExceptionsFilter', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useBodyParser('json', { limit: '1kb' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders validation errors with field paths', async () => {
    const res = await request(app.getHttpServer()).get('/probe/validation');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      errors: [{ field: 'entries[0].date', message: 'date is required' }],
    });
  });

  it('keeps the status and message of HTTP exceptions', async () => {
    const res = await request(app.getHttpServer()).get('/probe/missing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Nothing here' });
  });

  it('renders unknown routes as NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /nope' });
  });

  it('hides the details of unexpected errors', async () => {
    const res = await request(app.getHttpServer()).get('/probe/crash');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  it('turns malformed JSON into a 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"entries": [');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('turns an oversized body into a 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .send({ padding: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  });
});
```

- [ ] **Step 11: Run it and watch it fail**

Run: `npm test -- src/common/errors`
Expected: FAIL. `./all-exceptions.filter.js` cannot be resolved.

- [ ] **Step 12: Implement `src/common/errors/all-exceptions.filter.ts`**

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type FieldError, RequestValidationError } from './request-validation.error.js';

/** Body of every error response. */
export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  errors?: FieldError[];
  requestId?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  503: 'SERVICE_UNAVAILABLE',
};

/** Renders every error in one format. Unexpected errors become a generic 500 and are logged. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }
    // pino-http (Task 5) sets `request.id`; read it structurally so this file does not depend on its typings.
    const { id } = request as Request & { id?: unknown };
    const payload: ErrorResponseBody = { ...body, requestId: typeof id === 'string' ? id : undefined };
    response.status(body.statusCode).json(payload);
  }
}

function toErrorBody(exception: unknown): Omit<ErrorResponseBody, 'requestId'> {
  if (exception instanceof RequestValidationError) {
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: exception.message, errors: exception.errors };
  }
  if (exception instanceof HttpException) {
    return httpError(exception.getStatus(), exception.message);
  }
  if (isExposedClientError(exception)) {
    // Raised by Express middleware such as body-parser, e.g. 413 for an oversized body.
    return httpError(exception.status, exception.message);
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

function httpError(statusCode: number, message: string): Omit<ErrorResponseBody, 'requestId'> {
  const fallback = statusCode >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  return { statusCode, code: CODE_BY_STATUS[statusCode] ?? fallback, message };
}

/** An `http-errors` 4xx that is safe to show the client (`expose: true`). */
function isExposedClientError(value: unknown): value is { status: number; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { status, expose } = value as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}
```

`request.id` is set by pino-http from Task 5 on. In this probe app it is `undefined`, and `JSON.stringify` drops it. Body-parser failures also have no id, because they happen before the logging middleware runs.

- [ ] **Step 13: Run all unit tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 14: Commit**

```bash
git add src/common/errors/all-exceptions.filter.ts src/common/errors/all-exceptions.filter.spec.ts
git commit -m "feat: render every error in one structured format" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Database foundation, app wiring and e2e harness

**Files:**
- Create: `migrations/0001_create_schema.sql`, `migrations/0002_seed_exercise_catalog.sql`
- Create: `src/database/migrate.ts`, `src/database/database.module.ts`, `src/database/transaction.ts`
- Create: `src/core.module.ts`, `src/common/logging/request-id.ts`, `src/health/health.controller.ts`, `src/app.module.ts`, `src/app.setup.ts`, `src/main.ts`
- Create: `vitest.config.e2e.ts`, `test/global-setup.ts`, `test/helpers/test-app.ts`
- Test: `test/database.e2e-spec.ts`, `test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, `AppConfig`, `loadConfig` (Task 1); `CLOCK`, `Clock`, `systemClock` (Task 3); `AllExceptionsFilter` (Task 4).
- Produces:
  - `migrate(pool: Pool, dir?: string): Promise<string[]>` (names of newly applied files), `MIGRATIONS_DIR`
  - `PG_POOL: symbol`; `DatabaseModule` (global, exports `PG_POOL`, registers the DATE→string parser)
  - `withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T>`
  - `CoreModule` (global: `APP_CONFIG`, `CLOCK`), `AppModule`, `configureApp(app: NestExpressApplication): void`, `JSON_BODY_LIMIT = '1mb'`
  - Test helpers: `createTestApp(): Promise<TestApp>` with `interface TestApp { app: NestExpressApplication; pool: Pool }`, `resetWorkouts(pool)`, `TEST_NOW` (2026-10-15T12:00:00Z), `USER_A`, `USER_B`
  - Tables `exercises`, `muscle_groups`, `exercise_muscle_groups`, `workout_entries`, `workout_sets`, and a catalog of 16 exercises and 10 muscle groups.

- [ ] **Step 1: Write the e2e config and the Testcontainers global setup**

`vitest.config.e2e.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Spec files share one database and truncate it between tests, so run them one at a time.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
```

`test/global-setup.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/database/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Starts one Postgres 18 container for the whole e2e run and applies the migrations once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const databaseUrl = container.getConnectionUri();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
```

- [ ] **Step 2: Write the failing database test**

`test/database.e2e-spec.ts`:

```ts
import { Pool } from 'pg';
import { inject } from 'vitest';
import '../src/database/database.module.js'; // registers the DATE type parser
import { migrate } from '../src/database/migrate.js';
import { withTransaction } from '../src/database/transaction.js';

describe('database', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject('databaseUrl') });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has nothing left to migrate after the global setup', async () => {
    await expect(migrate(pool)).resolves.toEqual([]);
  });

  it('seeds the exercise catalog, each exercise mapped to muscle groups', async () => {
    const { rows } = await pool.query<{ name: string; groups: number }>(
      `SELECT e.name::text AS name, count(em.muscle_group_id)::int AS groups
       FROM exercises e LEFT JOIN exercise_muscle_groups em ON em.exercise_id = e.id
       GROUP BY e.name`,
    );
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.groups > 0)).toBe(true);
  });

  it('returns DATE columns as YYYY-MM-DD strings, independent of the server time zone', async () => {
    const { rows } = await pool.query<{ day: string }>("SELECT DATE '2026-10-14' AS day");
    expect(rows[0].day).toBe('2026-10-14');
  });

  it('rolls back every statement when the work fails', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query("INSERT INTO muscle_groups (name) VALUES ('forearms')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rowCount } = await pool.query("SELECT 1 FROM muscle_groups WHERE name = 'forearms'");
    expect(rowCount).toBe(0);
  });

  it('rejects negative weights at the storage boundary', async () => {
    await expect(
      pool.query(
        `INSERT INTO workout_entries (id, user_id, exercise_id, performed_on, best_weight_kg, best_volume_kg, best_e1rm_kg)
         SELECT gen_random_uuid(), gen_random_uuid(), id, DATE '2026-10-14', -1, 0, 0 FROM exercises LIMIT 1`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test:e2e`
Expected: FAIL. The global setup cannot load `../src/database/migrate.js`. Docker must be running, and the first run pulls `postgres:18-alpine`.

- [ ] **Step 4: Write the migrations**

`migrations/0001_create_schema.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fixed catalog, seeded by migration (ADR 0004).
CREATE TABLE exercises (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Partial, case-insensitive name search. citext has no trigram operator class, so index the text cast.
CREATE INDEX exercises_name_trgm_idx ON exercises USING gin ((name::text) gin_trgm_ops);

CREATE TABLE muscle_groups (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext NOT NULL UNIQUE
);

-- The exercise → muscle group mapping is data, so it can change without code changes.
CREATE TABLE exercise_muscle_groups (
  exercise_id     uuid NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  muscle_group_id uuid NOT NULL REFERENCES muscle_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (exercise_id, muscle_group_id)
);
CREATE INDEX exercise_muscle_groups_muscle_group_idx ON exercise_muscle_groups (muscle_group_id);

-- One row per logged exercise session. Entries are immutable, so the best_* summaries,
-- computed when the entry is written (ADR 0001), never go stale.
CREATE TABLE workout_entries (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  exercise_id     uuid NOT NULL REFERENCES exercises (id),
  performed_on    date NOT NULL,
  idempotency_key text,
  best_weight_kg  numeric(10, 3) NOT NULL CHECK (best_weight_kg >= 0),
  best_volume_kg  numeric(14, 3) NOT NULL CHECK (best_volume_kg >= 0),
  best_e1rm_kg    numeric(12, 3) NOT NULL CHECK (best_e1rm_kg >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_entries_user_idempotency_key_key UNIQUE (user_id, idempotency_key)
);
-- History, newest first, with keyset pagination in ADR 0002 order.
CREATE INDEX workout_entries_history_idx
  ON workout_entries (user_id, performed_on DESC, created_at DESC, id DESC);
-- PRs within a date range, and history filtered to specific exercises.
CREATE INDEX workout_entries_exercise_date_idx
  ON workout_entries (user_id, exercise_id, performed_on);
-- PR lookups: the first row is the record; performed_on dates a tie by its first occurrence.
CREATE INDEX workout_entries_best_weight_idx
  ON workout_entries (user_id, exercise_id, best_weight_kg DESC, performed_on);
CREATE INDEX workout_entries_best_volume_idx
  ON workout_entries (user_id, exercise_id, best_volume_kg DESC, performed_on);
CREATE INDEX workout_entries_best_e1rm_idx
  ON workout_entries (user_id, exercise_id, best_e1rm_kg DESC, performed_on);

-- Sets keep the logged weight and unit next to the normalized kilograms. `unit` is TEXT,
-- validated by the unit registry in code, so adding a unit needs no migration.
CREATE TABLE workout_sets (
  entry_id  uuid NOT NULL REFERENCES workout_entries (id) ON DELETE CASCADE,
  set_index smallint NOT NULL CHECK (set_index >= 0),
  reps      integer NOT NULL CHECK (reps > 0),
  weight    numeric(10, 3) NOT NULL CHECK (weight >= 0),
  unit      text NOT NULL,
  weight_kg numeric(10, 3) NOT NULL CHECK (weight_kg >= 0),
  PRIMARY KEY (entry_id, set_index)
);
```

`migrations/0002_seed_exercise_catalog.sql`:

```sql
INSERT INTO muscle_groups (name) VALUES
  ('chest'), ('back'), ('shoulders'), ('biceps'), ('triceps'),
  ('quadriceps'), ('hamstrings'), ('glutes'), ('calves'), ('core');

INSERT INTO exercises (name) VALUES
  ('Bench Press'), ('Incline Bench Press'), ('Overhead Press'),
  ('Back Squat'), ('Front Squat'), ('Leg Press'), ('Walking Lunge'),
  ('Deadlift'), ('Romanian Deadlift'), ('Hip Thrust'), ('Calf Raise'),
  ('Barbell Row'), ('Pull-Up'), ('Lat Pulldown'),
  ('Bicep Curl'), ('Tricep Pushdown');

INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id)
SELECT e.id, m.id
FROM (VALUES
  ('Bench Press', 'chest'), ('Bench Press', 'triceps'), ('Bench Press', 'shoulders'),
  ('Incline Bench Press', 'chest'), ('Incline Bench Press', 'shoulders'), ('Incline Bench Press', 'triceps'),
  ('Overhead Press', 'shoulders'), ('Overhead Press', 'triceps'),
  ('Back Squat', 'quadriceps'), ('Back Squat', 'glutes'), ('Back Squat', 'hamstrings'),
  ('Front Squat', 'quadriceps'), ('Front Squat', 'glutes'), ('Front Squat', 'core'),
  ('Leg Press', 'quadriceps'), ('Leg Press', 'glutes'),
  ('Walking Lunge', 'quadriceps'), ('Walking Lunge', 'glutes'), ('Walking Lunge', 'hamstrings'),
  ('Deadlift', 'back'), ('Deadlift', 'hamstrings'), ('Deadlift', 'glutes'),
  ('Romanian Deadlift', 'hamstrings'), ('Romanian Deadlift', 'glutes'), ('Romanian Deadlift', 'back'),
  ('Hip Thrust', 'glutes'), ('Hip Thrust', 'hamstrings'),
  ('Calf Raise', 'calves'),
  ('Barbell Row', 'back'), ('Barbell Row', 'biceps'),
  ('Pull-Up', 'back'), ('Pull-Up', 'biceps'),
  ('Lat Pulldown', 'back'), ('Lat Pulldown', 'biceps'),
  ('Bicep Curl', 'biceps'),
  ('Tricep Pushdown', 'triceps')
) AS mapping (exercise_name, muscle_group_name)
JOIN exercises e ON e.name = mapping.exercise_name
JOIN muscle_groups m ON m.name = mapping.muscle_group_name;
```

- [ ] **Step 5: Implement the migration runner, database module and transaction helper**

`src/database/migrate.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** `migrations/` at the project root, from both `src/database` and `dist/database`. */
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

// Any constant works; it serializes concurrent runs, e.g. two replicas starting at once.
const MIGRATION_LOCK_ID = 7_294_001;

/**
 * Applies pending `*.sql` files in name order, each in its own transaction, and records them
 * in `schema_migrations`. Returns the names applied by this call.
 */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const pending = (await readdir(dir)).filter((file) => file.endsWith('.sql') && !applied.has(file)).sort();
    for (const file of pending) {
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return pending;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
```

`src/database/database.module.ts`:

```ts
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

// DATE columns hold calendar days (ADR 0002). Keep them as 'YYYY-MM-DD' strings: the default
// parser builds a JS Date at local midnight, which shifts the day in some time zones.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/** Injection token for the shared `pg` Pool. */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const pool = new Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
        // An idle client can lose its connection; log it instead of crashing the process.
        pool.on('error', (error) => new Logger('Database').error(error));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
```

`src/database/transaction.ts`:

```ts
import type { Pool, PoolClient } from 'pg';

/** Runs `work` in a transaction on one pooled connection; rolls back and rethrows on failure. */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connectionBroken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      connectionBroken = true;
    });
    throw error;
  } finally {
    // `true` destroys a connection that could not roll back instead of returning it to the pool.
    client.release(connectionBroken);
  }
}
```

- [ ] **Step 6: Run the database test and watch it pass**

Run: `npm run test:e2e -- test/database.e2e-spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add migrations src/database vitest.config.e2e.ts test/global-setup.ts test/database.e2e-spec.ts
git commit -m "feat: add PostgreSQL schema, exercise catalog seed and migration runner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Write the test-app helper and the failing health test**

`test/helpers/test-app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CLOCK, type Clock } from '../../src/common/clock.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { PG_POOL } from '../../src/database/database.module.js';

/** "Now" in every e2e test, so the latest accepted workout day is 2026-10-16. */
export const TEST_NOW = new Date('2026-10-15T12:00:00Z');

export const USER_A = '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e';
export const USER_B = '5c2d7e9f-1a3b-4c5d-8e7f-9a0b1c2d3e4f';

export interface TestApp {
  app: NestExpressApplication;
  pool: Pool;
}

/** The real AppModule against the Testcontainers database, with silent logs and a fixed clock. */
export async function createTestApp(): Promise<TestApp> {
  const config: AppConfig = { databaseUrl: inject('databaseUrl'), port: 0, logLevel: 'silent', dbPoolMax: 20 };
  const clock: Clock = { now: () => TEST_NOW };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, pool: app.get<Pool>(PG_POOL) };
}

/** Removes all logged workouts; the seeded exercise catalog stays. */
export async function resetWorkouts(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE workout_entries CASCADE');
}
```

`test/health.e2e-spec.ts`:

```ts
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('GET /health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('reports ok when the database answers', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echoes a safe X-Request-Id and generates one otherwise', async () => {
    const echoed = await request(t.app.getHttpServer()).get('/health').set('X-Request-Id', 'demo-123');
    expect(echoed.headers['x-request-id']).toBe('demo-123');
    const generated = await request(t.app.getHttpServer()).get('/health').set('X-Request-Id', 'bad id');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the request id in error responses', async () => {
    const res = await request(t.app.getHttpServer()).get('/nope').set('X-Request-Id', 'trace-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /nope',
      requestId: 'trace-1',
    });
  });

  it('does not advertise the framework', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npm run test:e2e -- test/health.e2e-spec.ts`
Expected: FAIL. `../../src/app.module.js` cannot be resolved.

- [ ] **Step 10: Implement the core module, request ids, health check, app module, setup and main**

`src/core.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './common/clock.js';
import { APP_CONFIG, loadConfig } from './config/app-config.js';

/** App-wide providers: validated configuration and the clock. */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [APP_CONFIG, CLOCK],
})
export class CoreModule {}
```

`src/common/logging/request-id.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_REQUEST_ID = /^[\w.-]{1,100}$/;

/** Reuses the caller's X-Request-Id when it looks safe, otherwise generates one, and echoes it back. */
export function assignRequestId(request: IncomingMessage, response: ServerResponse): string {
  const incoming = request.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  response.setHeader('X-Request-Id', id);
  return id;
}
```

`src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness and database reachability; used by the Docker health check. */
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return { status: 'ok' };
  }
}
```

`src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { assignRequestId } from './common/logging/request-id.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { CoreModule } from './core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: { level: config.logLevel, genReqId: assignRequestId },
      }),
    }),
    DatabaseModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
```

`src/app.setup.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

/** Largest accepted JSON body. A full bulk request (50 entries × 50 sets) is just over 100 kB. */
export const JSON_BODY_LIMIT = '1mb';

/** HTTP setup shared by main.ts and the end-to-end tests. */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.disable('x-powered-by');
}
```

`src/main.ts`:

```ts
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { PG_POOL } from './database/database.module.js';
import { migrate } from './database/migrate.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
configureApp(app);
app.enableShutdownHooks();

// The runner takes an advisory lock, so several instances can start at the same time safely.
const applied = await migrate(app.get<Pool>(PG_POOL));
new Logger('Migrations').log(applied.length > 0 ? `Applied ${applied.join(', ')}` : 'Schema is up to date');

await app.listen(app.get<AppConfig>(APP_CONFIG).port);
```

- [ ] **Step 11: Run all tests, typecheck, lint and build**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint && npm run build && ls dist/main.js`
Expected: all pass; `dist/main.js` exists. (`main.ts` is exercised end to end by `docker compose` in Task 13.)

- [ ] **Step 12: Commit**

```bash
git add src/core.module.ts src/common/logging src/health src/app.module.ts src/app.setup.ts src/main.ts test/helpers/test-app.ts test/health.e2e-spec.ts
git commit -m "feat: wire NestJS app with structured logging, request ids and health check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Exercise catalog (ADR 0004)

**Files:**
- Create: `src/exercises/like-pattern.ts`, `src/exercises/exercises.repository.ts`, `src/exercises/exercises.controller.ts`, `src/exercises/exercises.module.ts`
- Modify: `src/app.module.ts` (import `ExercisesModule`)
- Test: `src/exercises/like-pattern.spec.ts`, `test/exercises.e2e-spec.ts`

**Interfaces:**
- Consumes: `PG_POOL` (Task 5), `FieldError` (Task 4).
- Produces:
  - `escapeLikePattern(value: string): string`
  - `interface CatalogExercise { name: string; muscleGroups: string[] }`, `interface ExerciseRef { id: string; name: string }`, `interface ExerciseFilter { nameContains?: string; muscleGroup?: string }`
  - `exerciseKey(name: string): string` (trimmed, lower-case lookup key)
  - `unknownExercise(field: string, name: string): FieldError`
  - `class ExercisesRepository` with `findAll(): Promise<CatalogExercise[]>`, `resolveNames(names: readonly string[]): Promise<Map<string, ExerciseRef>>` (keyed by `exerciseKey`), `findIds(filter: ExerciseFilter): Promise<string[]>`, `listMuscleGroups(): Promise<string[]>`
  - `ExercisesModule` (exports `ExercisesRepository`); `GET /exercises` → `{ data: CatalogExercise[] }`

- [ ] **Step 1: Write the failing LIKE-escaping test**

`src/exercises/like-pattern.spec.ts`:

```ts
import { escapeLikePattern } from './like-pattern.js';

describe('escapeLikePattern', () => {
  it('escapes the % and _ wildcards', () => {
    expect(escapeLikePattern('100%_done')).toBe('100\\%\\_done');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('Bench Press')).toBe('Bench Press');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/exercises`
Expected: FAIL. `./like-pattern.js` cannot be resolved.

- [ ] **Step 3: Implement `src/exercises/like-pattern.ts`**

```ts
/** Escapes LIKE wildcards so user input matches literally (`%` and `_` are not wildcards). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
```

Run: `npm test -- src/exercises`
Expected: PASS.

- [ ] **Step 4: Write the failing catalog e2e test**

`test/exercises.e2e-spec.ts`:

```ts
import type { Pool } from 'pg';
import request from 'supertest';
import { ExercisesRepository, exerciseKey } from '../src/exercises/exercises.repository.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

async function namesOf(pool: Pool, ids: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name::text AS name FROM exercises WHERE id = ANY($1::uuid[]) ORDER BY name',
    [ids],
  );
  return rows.map((row) => row.name);
}

describe('exercise catalog', () => {
  let t: TestApp;
  let repository: ExercisesRepository;

  beforeAll(async () => {
    t = await createTestApp();
    repository = t.app.get(ExercisesRepository);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /exercises lists the seeded catalog with muscle groups', async () => {
    const res = await request(t.app.getHttpServer()).get('/exercises');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(16);
    expect(res.body.data).toContainEqual({ name: 'Bench Press', muscleGroups: ['chest', 'shoulders', 'triceps'] });
  });

  it('resolves names trimmed and case-insensitively to the canonical name', async () => {
    const resolved = await repository.resolveNames(['  bench PRESS ', 'Deadlift', 'Benchpress']);
    expect(resolved.get(exerciseKey('  bench PRESS '))?.name).toBe('Bench Press');
    expect(resolved.get('deadlift')?.name).toBe('Deadlift');
    expect(resolved.has('benchpress')).toBe(false);
  });

  it('finds exercises by partial name, case-insensitively', async () => {
    expect(await namesOf(t.pool, await repository.findIds({ nameContains: 'SQUAT' }))).toEqual([
      'Back Squat',
      'Front Squat',
    ]);
  });

  it('treats LIKE wildcards in the name literally', async () => {
    await expect(repository.findIds({ nameContains: '%' })).resolves.toEqual([]);
    await expect(repository.findIds({ nameContains: '_' })).resolves.toEqual([]);
  });

  it('finds exercises by muscle group and combines both filters', async () => {
    expect(await namesOf(t.pool, await repository.findIds({ muscleGroup: 'Calves' }))).toEqual(['Calf Raise']);
    expect(
      await namesOf(t.pool, await repository.findIds({ nameContains: 'press', muscleGroup: 'chest' })),
    ).toEqual(['Bench Press', 'Incline Bench Press']);
  });

  it('lists muscle groups alphabetically', async () => {
    await expect(repository.listMuscleGroups()).resolves.toEqual([
      'back', 'biceps', 'calves', 'chest', 'core', 'glutes', 'hamstrings', 'quadriceps', 'shoulders', 'triceps',
    ]);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/exercises.e2e-spec.ts`
Expected: FAIL. `../src/exercises/exercises.repository.js` cannot be resolved.

- [ ] **Step 6: Implement the repository, controller and module**

`src/exercises/exercises.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { FieldError } from '../common/errors/request-validation.error.js';
import { PG_POOL } from '../database/database.module.js';
import { escapeLikePattern } from './like-pattern.js';

export interface CatalogExercise {
  name: string;
  muscleGroups: string[];
}

export interface ExerciseRef {
  id: string;
  /** Canonical catalog name. */
  name: string;
}

export interface ExerciseFilter {
  /** Case-insensitive substring of the exercise name, matched literally. */
  nameContains?: string;
  /** Exact muscle group name, case-insensitive. */
  muscleGroup?: string;
}

/** Lookup key for exercise names: trimmed and case-insensitive (ADR 0004). */
export function exerciseKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The standard 400 detail for a name that is not in the catalog. */
export function unknownExercise(field: string, name: string): FieldError {
  return { field, message: `Unknown exercise "${name}". GET /exercises lists the valid names` };
}

@Injectable()
export class ExercisesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(): Promise<CatalogExercise[]> {
    const { rows } = await this.pool.query<{ name: string; muscle_groups: string[] }>(
      `SELECT e.name::text AS name,
              coalesce(array_agg(m.name::text ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL), '{}') AS muscle_groups
       FROM exercises e
       LEFT JOIN exercise_muscle_groups em ON em.exercise_id = e.id
       LEFT JOIN muscle_groups m ON m.id = em.muscle_group_id
       GROUP BY e.id
       ORDER BY e.name`,
    );
    return rows.map((row) => ({ name: row.name, muscleGroups: row.muscle_groups }));
  }

  /** Resolves names to catalog exercises, keyed by `exerciseKey`. Unknown names are absent from the map. */
  async resolveNames(names: readonly string[]): Promise<Map<string, ExerciseRef>> {
    const keys = [...new Set(names.map(exerciseKey))];
    const { rows } = await this.pool.query<ExerciseRef>(
      'SELECT id, name::text AS name FROM exercises WHERE name = ANY($1::citext[])',
      [keys],
    );
    return new Map(rows.map((row) => [exerciseKey(row.name), row]));
  }

  /** Ids of exercises matching every given filter. */
  async findIds(filter: ExerciseFilter): Promise<string[]> {
    const namePattern = filter.nameContains === undefined ? null : `%${escapeLikePattern(filter.nameContains)}%`;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT e.id
       FROM exercises e
       WHERE ($1::text IS NULL OR e.name::text ILIKE $1)
         AND ($2::citext IS NULL OR EXISTS (
               SELECT 1
               FROM exercise_muscle_groups em
               JOIN muscle_groups m ON m.id = em.muscle_group_id
               WHERE em.exercise_id = e.id AND m.name = $2::citext))`,
      [namePattern, filter.muscleGroup ?? null],
    );
    return rows.map((row) => row.id);
  }

  async listMuscleGroups(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(
      'SELECT name::text AS name FROM muscle_groups ORDER BY name',
    );
    return rows.map((row) => row.name);
  }
}
```

`src/exercises/exercises.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { type CatalogExercise, ExercisesRepository } from './exercises.repository.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesRepository) {}

  /** The fixed exercise catalog with muscle groups; clients log with these names (ADR 0004). */
  @Get()
  async list(): Promise<{ data: CatalogExercise[] }> {
    return { data: await this.exercises.findAll() };
  }
}
```

`src/exercises/exercises.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesRepository } from './exercises.repository.js';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesRepository],
  exports: [ExercisesRepository],
})
export class ExercisesModule {}
```

In `src/app.module.ts`, add the import line and the module:

```ts
import { ExercisesModule } from './exercises/exercises.module.js';
```

```ts
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: { level: config.logLevel, genReqId: assignRequestId },
      }),
    }),
    DatabaseModule,
    ExercisesModule,
  ],
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/exercises src/app.module.ts test/exercises.e2e-spec.ts
git commit -m "feat: expose the seeded exercise catalog and name lookups (ADR 0004)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Log workout entries (POST, bulk, all-or-nothing)

**Files:**
- Create: `src/workouts/workout-entry.ts`, `src/workouts/workout-entry.presenter.ts`, `src/workouts/workout-entries.schemas.ts`, `src/workouts/workout-entries.repository.ts`, `src/workouts/workout-entries.service.ts`, `src/workouts/workout-entries.controller.ts`, `src/workouts/workouts.module.ts`
- Modify: `src/app.module.ts` (import `WorkoutsModule`)
- Create: `test/helpers/requests.ts`
- Test: `src/workouts/workout-entry.presenter.spec.ts`, `test/log-entries.e2e-spec.ts`

**Interfaces:**
- Consumes: `summarizeSets`, `EntrySummary` (Task 2); `convertWeight`, `roundForStorage`, `roundForDisplay`, `WeightUnit` (Task 2); `parseWorkoutDate`, `latestAllowedWorkoutDate`, `CLOCK`, `Clock` (Task 3); `ZodValidationPipe`, `requiredError`, `exerciseNameSchema`, `weightUnitSchema`, `userIdParamSchema`, `RequestValidationError`, `FieldError` (Task 4); `PG_POOL`, `withTransaction` (Task 5); `ExercisesModule`, `ExercisesRepository`, `ExerciseRef`, `exerciseKey`, `unknownExercise` (Task 6).
- Produces:
  - `interface StoredSet { reps: number; weight: string; unit: WeightUnit; weightKg: string }`, `interface WorkoutEntry { id; userId; exerciseName; performedOn; createdAt; sets: StoredSet[] }`, `interface NewSet { reps; weight: Decimal; unit; weightKg: Decimal }`, `interface NewEntry { id; exerciseId; performedOn; summary: EntrySummary; sets: NewSet[] }`
  - `interface SetResponse { reps; weight: number; unit }`, `interface EntryResponse { id; userId; date; exerciseName; sets: SetResponse[]; createdAt }`, `presentEntry(entry: WorkoutEntry, unit?: WeightUnit): EntryResponse`
  - `logEntriesBodySchema`, `type LogEntriesBody`, `type LogEntryInput`, `MAX_ENTRIES_PER_REQUEST = 50`, `MAX_SETS_PER_ENTRY = 50`, `MAX_REPS = 1000`, `MAX_WEIGHT = 5000`
  - `selectEntries(innerSql: string, orderBy: string): string`; `class WorkoutEntriesRepository` with `insertEntries(userId, entries: readonly NewEntry[]): Promise<WorkoutEntry[]>` and `findByIds(ids, db?): Promise<WorkoutEntry[]>`
  - `class WorkoutEntriesService` with `logEntries(userId: string, body: LogEntriesBody): Promise<WorkoutEntry[]>`
  - `POST /users/:userId/workout-entries` → 201 `{ data: EntryResponse[] }`
  - Test helpers: `set()`, `entry()`, `logEntries()`, `logOk()`, `entriesOf()`, `fieldsOf()`, `countEntries()`

- [ ] **Step 1: Write the domain types and the failing presenter test**

`src/workouts/workout-entry.ts`:

```ts
import type { Decimal } from 'decimal.js';
import type { EntrySummary } from '../domain/set-metrics.js';
import type { WeightUnit } from '../domain/weight-units.js';

/** A set as stored: the logged weight and unit plus the normalized kilograms (decimal strings). */
export interface StoredSet {
  reps: number;
  weight: string;
  unit: WeightUnit;
  weightKg: string;
}

export interface WorkoutEntry {
  id: string;
  userId: string;
  /** Canonical catalog name. */
  exerciseName: string;
  /** The client's calendar day, YYYY-MM-DD (ADR 0002). */
  performedOn: string;
  /** UTC with microseconds, e.g. 2026-10-15T09:09:08.404114Z; also part of the history cursor. */
  createdAt: string;
  sets: StoredSet[];
}

export interface NewSet {
  reps: number;
  weight: Decimal;
  unit: WeightUnit;
  weightKg: Decimal;
}

export interface NewEntry {
  id: string;
  exerciseId: string;
  performedOn: string;
  summary: EntrySummary;
  sets: NewSet[];
}
```

`src/workouts/workout-entry.presenter.spec.ts`:

```ts
import { presentEntry } from './workout-entry.presenter.js';
import type { WorkoutEntry } from './workout-entry.js';

const entry: WorkoutEntry = {
  id: 'e1',
  userId: 'u1',
  exerciseName: 'Bench Press',
  performedOn: '2026-10-14',
  createdAt: '2026-10-15T09:09:08.404114Z',
  sets: [
    { reps: 5, weight: '100.000', unit: 'kg', weightKg: '100.000' },
    { reps: 8, weight: '225.000', unit: 'lb', weightKg: '102.058' },
  ],
};

describe('presentEntry', () => {
  it('returns sets as logged when no unit is requested', () => {
    expect(presentEntry(entry)).toEqual({
      id: 'e1',
      userId: 'u1',
      date: '2026-10-14',
      exerciseName: 'Bench Press',
      sets: [
        { reps: 5, weight: 100, unit: 'kg' },
        { reps: 8, weight: 225, unit: 'lb' },
      ],
      createdAt: '2026-10-15T09:09:08.404114Z',
    });
  });

  it('converts other units and keeps sets already in the requested unit exact', () => {
    expect(presentEntry(entry, 'lb').sets).toEqual([
      { reps: 5, weight: 220.46, unit: 'lb' },
      { reps: 8, weight: 225, unit: 'lb' },
    ]);
    expect(presentEntry(entry, 'kg').sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 8, weight: 102.06, unit: 'kg' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/workouts`
Expected: FAIL. `./workout-entry.presenter.js` cannot be resolved.

- [ ] **Step 3: Implement `src/workouts/workout-entry.presenter.ts`**

```ts
import { type WeightUnit, convertWeight, roundForDisplay } from '../domain/weight-units.js';
import type { StoredSet, WorkoutEntry } from './workout-entry.js';

export interface SetResponse {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

export interface EntryResponse {
  id: string;
  userId: string;
  date: string;
  exerciseName: string;
  sets: SetResponse[];
  createdAt: string;
}

/**
 * Shapes an entry for the API. With `unit`, every set is converted to it and rounded to two
 * decimals, but a set already in that unit keeps its exact logged weight. Without `unit`,
 * sets are returned as logged.
 */
export function presentEntry(entry: WorkoutEntry, unit?: WeightUnit): EntryResponse {
  return {
    id: entry.id,
    userId: entry.userId,
    date: entry.performedOn,
    exerciseName: entry.exerciseName,
    sets: entry.sets.map((set) => presentSet(set, unit)),
    createdAt: entry.createdAt,
  };
}

function presentSet(set: StoredSet, unit: WeightUnit | undefined): SetResponse {
  if (unit === undefined || unit === set.unit) {
    return { reps: set.reps, weight: Number(set.weight), unit: set.unit };
  }
  return { reps: set.reps, weight: roundForDisplay(convertWeight(set.weight, set.unit, unit)), unit };
}
```

Run: `npm test -- src/workouts`
Expected: PASS.

- [ ] **Step 4: Write the e2e request helpers and the failing logging test**

`test/helpers/requests.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { FieldError } from '../../src/common/errors/request-validation.error.js';
import type { EntryResponse } from '../../src/workouts/workout-entry.presenter.js';

export interface SetInput {
  reps: number;
  weight: number;
  unit: string;
}

export function set(reps: number, weight: number, unit = 'kg'): SetInput {
  return { reps, weight, unit };
}

export function entry(date: string, exerciseName: string, sets: SetInput[] = [set(5, 100)]) {
  return { date, exerciseName, sets };
}

export function logEntries(
  app: NestExpressApplication,
  userId: string,
  entries: unknown[],
  idempotencyKey?: string,
) {
  return request(app.getHttpServer())
    .post(`/users/${userId}/workout-entries`)
    .set(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey })
    .send({ entries });
}

/** Logs entries that must be accepted and returns them. */
export async function logOk(app: NestExpressApplication, userId: string, entries: unknown[]): Promise<EntryResponse[]> {
  const res = await logEntries(app, userId, entries);
  expect(res.status).toBe(201);
  return entriesOf(res);
}

/** The `data` array of an entries response. */
export function entriesOf(res: Response): EntryResponse[] {
  return (res.body as { data: EntryResponse[] }).data;
}

/** The `field` of every error in an error response. */
export function fieldsOf(res: Response): string[] {
  return (res.body as { errors: FieldError[] }).errors.map((error) => error.field);
}

export async function countEntries(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM workout_entries');
  return rows[0].count;
}
```

`test/log-entries.e2e-spec.ts`:

```ts
import request from 'supertest';
import { countEntries, entriesOf, entry, fieldsOf, logEntries, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface InvalidCase {
  name: string;
  override: Record<string, unknown>;
  field: string;
  message: unknown;
}

describe('POST /users/:userId/workout-entries', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('logs an entry and returns it with the canonical exercise name', async () => {
    const res = await logEntries(t.app, USER_A, [entry('2026-10-14', '  bench PRESS ', [set(5, 100), set(3, 102.5)])]);
    expect(res.status).toBe(201);
    expect(entriesOf(res)).toEqual([
      {
        id: expect.stringMatching(UUID),
        userId: USER_A,
        date: '2026-10-14',
        exerciseName: 'Bench Press',
        sets: [
          { reps: 5, weight: 100, unit: 'kg' },
          { reps: 3, weight: 102.5, unit: 'kg' },
        ],
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      },
    ]);
  });

  it('logs several exercises in one request, in request order', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Back Squat'),
      entry('2026-10-14', 'Bench Press'),
      entry('2026-10-13', 'Deadlift'),
    ]);
    expect(res.status).toBe(201);
    expect(entriesOf(res).map((e) => e.exerciseName)).toEqual(['Back Squat', 'Bench Press', 'Deadlift']);
    expect(await countEntries(t.pool)).toBe(3);
  });

  it('stores the logged weight and unit next to normalized kilograms and the PR summary', async () => {
    const res = await logEntries(t.app, USER_A, [entry('2026-10-14', 'Deadlift', [set(5, 225, 'lb'), set(1, 300, 'LB')])]);
    expect(res.status).toBe(201);
    const id = entriesOf(res)[0].id;
    const sets = await t.pool.query(
      'SELECT set_index, reps, weight::text, unit, weight_kg::text FROM workout_sets WHERE entry_id = $1 ORDER BY set_index',
      [id],
    );
    expect(sets.rows).toEqual([
      { set_index: 0, reps: 5, weight: '225.000', unit: 'lb', weight_kg: '102.058' },
      { set_index: 1, reps: 1, weight: '300.000', unit: 'lb', weight_kg: '136.078' },
    ]);
    const summary = await t.pool.query(
      'SELECT best_weight_kg::text, best_volume_kg::text, best_e1rm_kg::text FROM workout_entries WHERE id = $1',
      [id],
    );
    // Volume: 5 × 102.058; e1RM: 136.078 × (1 + 1/30) = 140.6139…
    expect(summary.rows[0]).toEqual({ best_weight_kg: '136.078', best_volume_kg: '510.290', best_e1rm_kg: '140.614' });
  });

  it("reads the date in the client's offset, never converting to UTC", async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14T06:00:00+07:00', 'Back Squat'),
      entry('2026-10-14T23:30:00-05:00', 'Back Squat'),
    ]);
    expect(res.status).toBe(201);
    expect(entriesOf(res).map((e) => e.date)).toEqual(['2026-10-14', '2026-10-14']);
  });

  it('accepts a day one past the UTC date and rejects later days', async () => {
    expect((await logEntries(t.app, USER_A, [entry('2026-10-16', 'Deadlift')])).status).toBe(201);
    const tooLate = await logEntries(t.app, USER_A, [entry('2026-10-17', 'Deadlift')]);
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.errors).toEqual([
      { field: 'entries[0].date', message: 'date must not be after 2026-10-16 (more than one day in the future)' },
    ]);
  });

  it('rejects unknown exercises, naming each field, and stores nothing from the request', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Bench Press'),
      entry('2026-10-14', 'Squat'),
      entry('2026-10-14', 'Benchpress'),
    ]);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'entries[1].exerciseName', message: 'Unknown exercise "Squat". GET /exercises lists the valid names' },
        { field: 'entries[2].exerciseName', message: 'Unknown exercise "Benchpress". GET /exercises lists the valid names' },
      ],
    });
    expect(await countEntries(t.pool)).toBe(0);
  });

  const invalidCases: InvalidCase[] = [
    { name: 'a null date', override: { date: null }, field: 'entries[0].date', message: 'date is required' },
    {
      name: 'a datetime without an offset',
      override: { date: '2026-10-14T06:00:00' },
      field: 'entries[0].date',
      message: expect.stringContaining('must include a UTC offset'),
    },
    {
      name: 'an impossible date',
      override: { date: '2026-02-30' },
      field: 'entries[0].date',
      message: '"2026-02-30" is not a valid calendar date',
    },
    { name: 'an empty sets array', override: { sets: [] }, field: 'entries[0].sets', message: 'sets must contain at least one set' },
    {
      name: 'a negative weight',
      override: { sets: [set(5, -10)] },
      field: 'entries[0].sets[0].weight',
      message: 'weight must not be negative',
    },
    { name: 'zero reps', override: { sets: [set(0, 10)] }, field: 'entries[0].sets[0].reps', message: 'reps must be at least 1' },
    {
      name: 'fractional reps',
      override: { sets: [set(2.5, 10)] },
      field: 'entries[0].sets[0].reps',
      message: 'reps must be a whole number',
    },
    {
      name: 'an unsupported unit',
      override: { sets: [set(5, 10, 'stone')] },
      field: 'entries[0].sets[0].unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
    {
      name: 'a weight sent as a string',
      override: { sets: [{ reps: 5, weight: '100', unit: 'kg' }] },
      field: 'entries[0].sets[0].weight',
      message: 'weight must be a number',
    },
    {
      name: 'a missing exercise name',
      override: { exerciseName: undefined },
      field: 'entries[0].exerciseName',
      message: 'exerciseName is required',
    },
    { name: 'an unexpected field', override: { userId: USER_B }, field: 'entries[0]', message: 'Unrecognized key: "userId"' },
  ];

  it.each(invalidCases)('rejects $name', async ({ override, field, message }) => {
    const res = await logEntries(t.app, USER_A, [{ ...entry('2026-10-14', 'Deadlift'), ...override }]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('reports every problem in the request at once', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Deadlift', [set(5, -1), set(0, 10, 'oz')]),
      { exerciseName: 'Deadlift', sets: [] },
    ]);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual([
      'entries[0].sets[0].weight',
      'entries[0].sets[1].reps',
      'entries[0].sets[1].unit',
      'entries[1].date',
      'entries[1].sets',
    ]);
  });

  it.each([
    { name: 'a JSON array body', body: [], field: 'body', message: 'Request body must be a JSON object' },
    { name: 'a missing entries field', body: {}, field: 'entries', message: 'entries is required' },
    { name: 'an empty entries array', body: { entries: [] }, field: 'entries', message: 'entries must contain at least one entry' },
    {
      name: 'more than 50 entries',
      body: { entries: Array.from({ length: 51 }, () => entry('2026-10-14', 'Deadlift')) },
      field: 'entries',
      message: 'entries must contain at most 50 entries',
    },
  ])('rejects $name', async ({ body, field, message }) => {
    const res = await request(t.app.getHttpServer()).post(`/users/${USER_A}/workout-entries`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('accepts the largest allowed request (50 entries × 50 sets, over 100 kB)', async () => {
    const sets = Array.from({ length: 50 }, () => set(10, 102.125, 'lb'));
    const entries = Array.from({ length: 50 }, () => entry('2026-10-14', 'Bench Press', sets));
    expect(Buffer.byteLength(JSON.stringify({ entries }))).toBeGreaterThan(100 * 1024);
    const res = await logEntries(t.app, USER_A, entries);
    expect(res.status).toBe(201);
    expect(entriesOf(res)).toHaveLength(50);
  });

  it('rejects a user id that is not a UUID', async () => {
    const res = await logEntries(t.app, 'coach-42', [entry('2026-10-14', 'Deadlift')]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'userId', message: 'userId must be a UUID' }]);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/log-entries.e2e-spec.ts`
Expected: FAIL with 404 `Cannot POST /users/…/workout-entries` (no route yet). Several tests fail.

- [ ] **Step 6: Implement the request schema**

`src/workouts/workout-entries.schemas.ts`:

```ts
import { z } from 'zod';
import { exerciseNameSchema, requiredError, weightUnitSchema } from '../common/validation/schemas.js';
import { parseWorkoutDate } from '../domain/workout-date.js';

export const MAX_ENTRIES_PER_REQUEST = 50;
export const MAX_SETS_PER_ENTRY = 50;
export const MAX_REPS = 1000;
export const MAX_WEIGHT = 5000;

/** `YYYY-MM-DD` or an ISO datetime with an offset, read as the calendar day in that offset (ADR 0002). */
const workoutDateSchema = z
  .string(requiredError('date', 'a string'))
  .trim()
  .transform((value, ctx) => {
    const parsed = parseWorkoutDate(value);
    if (parsed.ok) return parsed.date;
    ctx.addIssue({ code: 'custom', message: parsed.message });
    return z.NEVER;
  });

const setSchema = z.strictObject({
  reps: z
    .number(requiredError('reps', 'a number'))
    .int('reps must be a whole number')
    .min(1, 'reps must be at least 1')
    .max(MAX_REPS, `reps must be at most ${MAX_REPS}`),
  weight: z
    .number(requiredError('weight', 'a number'))
    .min(0, 'weight must not be negative')
    .max(MAX_WEIGHT, `weight must be at most ${MAX_WEIGHT}`),
  unit: weightUnitSchema,
});

const entrySchema = z.strictObject({
  date: workoutDateSchema,
  exerciseName: exerciseNameSchema(),
  sets: z
    .array(setSchema, requiredError('sets', 'an array'))
    .min(1, 'sets must contain at least one set')
    .max(MAX_SETS_PER_ENTRY, `sets must contain at most ${MAX_SETS_PER_ENTRY} sets`),
});

export const logEntriesBodySchema = z.strictObject(
  {
    entries: z
      .array(entrySchema, requiredError('entries', 'an array'))
      .min(1, 'entries must contain at least one entry')
      .max(MAX_ENTRIES_PER_REQUEST, `entries must contain at most ${MAX_ENTRIES_PER_REQUEST} entries`),
  },
  // A function, not a string: a string would also replace the "Unrecognized key" messages.
  { error: (issue) => (issue.code === 'invalid_type' ? 'Request body must be a JSON object' : undefined) },
);

export type LogEntriesBody = z.output<typeof logEntriesBodySchema>;
export type LogEntryInput = LogEntriesBody['entries'][number];
```

- [ ] **Step 7: Implement the repository**

`src/workouts/workout-entries.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { withTransaction } from '../database/transaction.js';
import type { NewEntry, StoredSet, WorkoutEntry } from './workout-entry.js';

type Queryable = Pool | PoolClient;

interface EntryRow {
  id: string;
  user_id: string;
  exercise_name: string;
  performed_on: string;
  created_at: string;
  sets: StoredSet[];
}

/**
 * Completes an inner query that selects `workout_entries` rows (id, user_id, exercise_id,
 * performed_on, created_at, plus any column `orderBy` needs) with the exercise name and the
 * sets. The inner query filters and limits first, so sets load only for the returned entries.
 * `created_at` keeps its microseconds so it can be used in a pagination cursor.
 */
export function selectEntries(innerSql: string, orderBy: string): string {
  return `
    SELECT p.id, p.user_id, x.name::text AS exercise_name, p.performed_on,
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           s.sets
    FROM (${innerSql}) p
    JOIN exercises x ON x.id = p.exercise_id
    CROSS JOIN LATERAL (
      SELECT coalesce(json_agg(json_build_object(
               'reps', ws.reps, 'weight', ws.weight::text, 'unit', ws.unit, 'weightKg', ws.weight_kg::text)
             ORDER BY ws.set_index), '[]') AS sets
      FROM workout_sets ws
      WHERE ws.entry_id = p.id
    ) s
    ORDER BY ${orderBy}`;
}

function toWorkoutEntry(row: EntryRow): WorkoutEntry {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseName: row.exercise_name,
    performedOn: row.performed_on,
    createdAt: row.created_at,
    sets: row.sets,
  };
}

@Injectable()
export class WorkoutEntriesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Inserts entries and their sets in one transaction, so a bulk request is all-or-nothing. */
  async insertEntries(userId: string, entries: readonly NewEntry[]): Promise<WorkoutEntry[]> {
    return withTransaction(this.pool, async (client) => {
      await insertEntryRows(client, userId, entries);
      await insertSetRows(client, entries);
      return this.findByIds(
        entries.map((entry) => entry.id),
        client,
      );
    });
  }

  /** Entries by id, in the order of `ids`. */
  async findByIds(ids: readonly string[], db: Queryable = this.pool): Promise<WorkoutEntry[]> {
    const { rows } = await db.query<EntryRow>(
      selectEntries(
        `SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at
         FROM workout_entries e
         WHERE e.id = ANY($1::uuid[])`,
        'array_position($1::uuid[], p.id)',
      ),
      [ids],
    );
    return rows.map(toWorkoutEntry);
  }
}

/** One multi-row INSERT for all entries of the request. */
async function insertEntryRows(client: PoolClient, userId: string, entries: readonly NewEntry[]): Promise<void> {
  await client.query(
    `INSERT INTO workout_entries
       (id, user_id, exercise_id, performed_on, best_weight_kg, best_volume_kg, best_e1rm_kg)
     SELECT t.id, $1::uuid, t.exercise_id, t.performed_on, t.best_weight_kg, t.best_volume_kg, t.best_e1rm_kg
     FROM unnest($2::uuid[], $3::uuid[], $4::date[], $5::numeric[], $6::numeric[], $7::numeric[])
       AS t (id, exercise_id, performed_on, best_weight_kg, best_volume_kg, best_e1rm_kg)`,
    [
      userId,
      entries.map((entry) => entry.id),
      entries.map((entry) => entry.exerciseId),
      entries.map((entry) => entry.performedOn),
      entries.map((entry) => entry.summary.bestWeightKg.toFixed()),
      entries.map((entry) => entry.summary.bestVolumeKg.toFixed()),
      entries.map((entry) => entry.summary.bestE1rmKg.toFixed()),
    ],
  );
}

/** One multi-row INSERT for every set of the given entries. */
async function insertSetRows(client: PoolClient, entries: readonly NewEntry[]): Promise<void> {
  const rows = entries.flatMap((entry) =>
    entry.sets.map((set, setIndex) => ({ entryId: entry.id, setIndex, ...set })),
  );
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO workout_sets (entry_id, set_index, reps, weight, unit, weight_kg)
     SELECT * FROM unnest($1::uuid[], $2::smallint[], $3::int[], $4::numeric[], $5::text[], $6::numeric[])`,
    [
      rows.map((row) => row.entryId),
      rows.map((row) => row.setIndex),
      rows.map((row) => row.reps),
      rows.map((row) => row.weight.toFixed()),
      rows.map((row) => row.unit),
      rows.map((row) => row.weightKg.toFixed()),
    ],
  );
}
```

- [ ] **Step 8: Implement the service, controller and module**

`src/workouts/workout-entries.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../common/clock.js';
import { type FieldError, RequestValidationError } from '../common/errors/request-validation.error.js';
import { summarizeSets } from '../domain/set-metrics.js';
import { convertWeight, roundForStorage } from '../domain/weight-units.js';
import { latestAllowedWorkoutDate } from '../domain/workout-date.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { WorkoutEntriesRepository } from './workout-entries.repository.js';
import type { LogEntriesBody, LogEntryInput } from './workout-entries.schemas.js';
import type { NewEntry, WorkoutEntry } from './workout-entry.js';

@Injectable()
export class WorkoutEntriesService {
  constructor(
    private readonly entries: WorkoutEntriesRepository,
    private readonly exercises: ExercisesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Logs one or more entries for a user. Every entry is checked first and all problems are
   * reported together; then everything is written in one transaction (all-or-nothing, ADR 0004).
   */
  async logEntries(userId: string, body: LogEntriesBody): Promise<WorkoutEntry[]> {
    const exercises = await this.exercises.resolveNames(body.entries.map((entry) => entry.exerciseName));
    const latestDate = latestAllowedWorkoutDate(this.clock.now());
    const errors: FieldError[] = [];
    const newEntries: NewEntry[] = [];
    body.entries.forEach((entry, index) => {
      if (entry.date > latestDate) {
        errors.push({
          field: `entries[${index}].date`,
          message: `date must not be after ${latestDate} (more than one day in the future)`,
        });
      }
      const exercise = exercises.get(exerciseKey(entry.exerciseName));
      if (exercise === undefined) {
        errors.push(unknownExercise(`entries[${index}].exerciseName`, entry.exerciseName));
      } else {
        newEntries.push(toNewEntry(entry, exercise));
      }
    });
    if (errors.length > 0) throw new RequestValidationError(errors);
    return this.entries.insertEntries(userId, newEntries);
  }
}

/** Normalizes weights to kilograms and computes the per-entry PR summary (ADR 0001). */
function toNewEntry(entry: LogEntryInput, exercise: ExerciseRef): NewEntry {
  const sets = entry.sets.map((set) => {
    const weight = roundForStorage(new Decimal(set.weight));
    return {
      reps: set.reps,
      weight,
      unit: set.unit,
      weightKg: roundForStorage(convertWeight(weight, set.unit, 'kg')),
    };
  });
  return {
    id: randomUUID(),
    exerciseId: exercise.id,
    performedOn: entry.date,
    summary: summarizeSets(sets),
    sets,
  };
}
```

`src/workouts/workout-entries.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { type LogEntriesBody, logEntriesBodySchema } from './workout-entries.schemas.js';
import { WorkoutEntriesService } from './workout-entries.service.js';
import { type EntryResponse, presentEntry } from './workout-entry.presenter.js';

@Controller('users/:userId/workout-entries')
export class WorkoutEntriesController {
  constructor(private readonly service: WorkoutEntriesService) {}

  /** Logs one or more exercise entries for a user; a bulk request is all-or-nothing. */
  @Post()
  async log(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Body(new ZodValidationPipe(logEntriesBodySchema)) body: LogEntriesBody,
  ): Promise<{ data: EntryResponse[] }> {
    const entries = await this.service.logEntries(userId, body);
    return { data: entries.map((entry) => presentEntry(entry)) };
  }
}
```

`src/workouts/workouts.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { WorkoutEntriesController } from './workout-entries.controller.js';
import { WorkoutEntriesRepository } from './workout-entries.repository.js';
import { WorkoutEntriesService } from './workout-entries.service.js';

@Module({
  imports: [ExercisesModule],
  controllers: [WorkoutEntriesController],
  providers: [WorkoutEntriesService, WorkoutEntriesRepository],
})
export class WorkoutsModule {}
```

In `src/app.module.ts`, add `import { WorkoutsModule } from './workouts/workouts.module.js';` and append `WorkoutsModule` after `ExercisesModule` in `imports`.

- [ ] **Step 9: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/workouts src/app.module.ts test/helpers/requests.ts test/log-entries.e2e-spec.ts
git commit -m "feat: log workout entries in bulk with unit normalization and PR summaries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Idempotent retries and concurrent writes (ADR 0003)

**Files:**
- Create: `src/workouts/idempotency-key.ts`
- Modify: `src/workouts/workout-entry.ts` (add `idempotencyKey` to `NewEntry`), `src/workouts/workout-entries.repository.ts` (whole file below), `src/workouts/workout-entries.service.ts` (whole file below), `src/workouts/workout-entries.controller.ts` (whole file below)
- Test: `src/workouts/idempotency-key.spec.ts`, `test/idempotency.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces:
  - `IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'`, `parseIdempotencyKey(raw: string | undefined): string | undefined` (throws `RequestValidationError`), `entryIdempotencyKey(requestKey: string, index: number): string`
  - `NewEntry.idempotencyKey: string | null`
  - `interface InsertResult { entries: WorkoutEntry[]; replayed: boolean }`. `WorkoutEntriesRepository.insertEntries(userId, entries): Promise<InsertResult>` and `findByIdempotencyKeys(userId, keys, db?): Promise<WorkoutEntry[]>`.
  - `WorkoutEntriesService.logEntries(userId, body, idempotencyKey?: string): Promise<InsertResult>`
  - The response header `Idempotent-Replayed: true` on replays.

- [ ] **Step 1: Write the failing key test**

`src/workouts/idempotency-key.spec.ts`:

```ts
import { RequestValidationError } from '../common/errors/request-validation.error.js';
import { entryIdempotencyKey, parseIdempotencyKey } from './idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it('allows the header to be absent', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('accepts visible ASCII keys, including #', () => {
    expect(parseIdempotencyKey('a1b2-c3#d4')).toBe('a1b2-c3#d4');
  });

  it.each(['', 'has space', 'x'.repeat(201), 'naïve'])('rejects %j', (raw) => {
    expect(() => parseIdempotencyKey(raw)).toThrow(RequestValidationError);
  });
});

describe('entryIdempotencyKey', () => {
  it("appends the entry's position in the request", () => {
    expect(entryIdempotencyKey('K', 0)).toBe('K#0');
    expect(entryIdempotencyKey('a#1', 10)).toBe('a#1#10');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/workouts/idempotency-key.spec.ts`
Expected: FAIL. `./idempotency-key.js` cannot be resolved.

- [ ] **Step 3: Implement `src/workouts/idempotency-key.ts`**

```ts
import { RequestValidationError } from '../common/errors/request-validation.error.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

const VALID_KEY = /^[\x21-\x7e]{1,200}$/;

/** Validates the optional Idempotency-Key header: 1–200 visible ASCII characters. */
export function parseIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (VALID_KEY.test(raw)) return raw;
  throw new RequestValidationError([
    {
      field: IDEMPOTENCY_KEY_HEADER,
      message: 'Idempotency-Key must be 1-200 visible ASCII characters without spaces',
    },
  ]);
}

/**
 * Per-entry key stored in `workout_entries.idempotency_key` (ADR 0003): the request key plus
 * the entry's position, `K#0`, `K#1`, … The index after the last `#` keeps keys from different
 * requests distinct even when a client's key contains `#`.
 */
export function entryIdempotencyKey(requestKey: string, index: number): string {
  return `${requestKey}#${index}`;
}
```

Run: `npm test -- src/workouts/idempotency-key.spec.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing idempotency and concurrency test**

`test/idempotency.e2e-spec.ts`:

```ts
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { summarizeSets } from '../src/domain/set-metrics.js';
import { WorkoutEntriesRepository } from '../src/workouts/workout-entries.repository.js';
import type { NewEntry } from '../src/workouts/workout-entry.js';
import { countEntries, entriesOf, entry, logEntries, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const benchPress = (weight: number) => entry('2026-10-14', 'Bench Press', [set(5, weight)]);

function newEntry(exerciseId: string, idempotencyKey: string, reps: number): NewEntry {
  const weight = new Decimal(100);
  return {
    id: randomUUID(),
    exerciseId,
    performedOn: '2026-10-14',
    idempotencyKey,
    summary: summarizeSets([{ reps, weightKg: weight }]),
    sets: [{ reps, weight, unit: 'kg', weightKg: weight }],
  };
}

describe('idempotent and concurrent logging', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('stores a retried request once and returns the original entries', async () => {
    const entries = [benchPress(100), entry('2026-10-14', 'Barbell Row', [set(8, 60)])];
    const first = await logEntries(t.app, USER_A, entries, 'req-1');
    const retry = await logEntries(t.app, USER_A, entries, 'req-1');
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await countEntries(t.pool)).toBe(2);
  });

  it('stores parallel identical requests once', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => logEntries(t.app, USER_A, [benchPress(100)], 'parallel-1')),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((res) => entriesOf(res)[0].id)).size).toBe(1);
    expect(await countEntries(t.pool)).toBe(1);
  });

  it('keeps every concurrent log of the same exercise on the same day without keys or with different keys', async () => {
    const withoutKeys = Array.from({ length: 5 }, () => logEntries(t.app, USER_A, [benchPress(100)]));
    const withKeys = Array.from({ length: 5 }, (_, i) => logEntries(t.app, USER_A, [benchPress(100)], `distinct-${i}`));
    const responses = await Promise.all([...withoutKeys, ...withKeys]);
    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(await countEntries(t.pool)).toBe(10);
  });

  it('scopes keys to the user', async () => {
    await logEntries(t.app, USER_A, [benchPress(100)], 'shared-key');
    const other = await logEntries(t.app, USER_B, [benchPress(80)], 'shared-key');
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(entriesOf(other)[0]).toMatchObject({ userId: USER_B, sets: [{ reps: 5, weight: 80, unit: 'kg' }] });
    expect(await countEntries(t.pool)).toBe(2);
  });

  it('returns the original entries when a key is reused with a different body (documented ADR 0003 limitation)', async () => {
    const first = await logEntries(t.app, USER_A, [benchPress(100)], 'reused');
    const second = await logEntries(t.app, USER_A, [benchPress(120)], 'reused');
    expect(entriesOf(second)).toEqual(entriesOf(first));
    expect(await countEntries(t.pool)).toBe(1);
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const res = await logEntries(t.app, USER_A, [benchPress(100)], 'has spaces');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'Idempotency-Key', message: expect.any(String) }]);
    expect(await countEntries(t.pool)).toBe(0);
  });

  it('stores nothing when a write fails part-way, and the same key can then be retried', async () => {
    const repository = t.app.get(WorkoutEntriesRepository);
    const { rows } = await t.pool.query<{ id: string }>("SELECT id FROM exercises WHERE name = 'Deadlift'");
    const good = newEntry(rows[0].id, 'atomic#0', 5);
    const bad = newEntry(rows[0].id, 'atomic#1', 0); // reps = 0 violates CHECK (reps > 0) on the second entry
    await expect(repository.insertEntries(USER_A, [good, bad])).rejects.toMatchObject({ code: '23514' });
    expect(await countEntries(t.pool)).toBe(0);

    const retry = await repository.insertEntries(USER_A, [good, newEntry(rows[0].id, 'atomic#1', 5)]);
    expect(retry.replayed).toBe(false);
    expect(retry.entries).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/idempotency.e2e-spec.ts`
Expected: FAIL. TypeScript reports `idempotencyKey` is not in `NewEntry`. At runtime, retries store duplicates and no replay header is sent.

- [ ] **Step 6: Add the key to `NewEntry`**

In `src/workouts/workout-entry.ts`, replace the `NewEntry` interface with:

```ts
export interface NewEntry {
  id: string;
  exerciseId: string;
  performedOn: string;
  /** `K#i` when the request carried an Idempotency-Key, otherwise null (ADR 0003). */
  idempotencyKey: string | null;
  summary: EntrySummary;
  sets: NewSet[];
}
```

- [ ] **Step 7: Replace `src/workouts/workout-entries.repository.ts` with the idempotent version**

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { withTransaction } from '../database/transaction.js';
import type { NewEntry, StoredSet, WorkoutEntry } from './workout-entry.js';

type Queryable = Pool | PoolClient;

interface EntryRow {
  id: string;
  user_id: string;
  exercise_name: string;
  performed_on: string;
  created_at: string;
  sets: StoredSet[];
}

export interface InsertResult {
  /** Stored entries in request order: new ones, plus earlier ones that share an idempotency key. */
  entries: WorkoutEntry[];
  /** True when at least one entry already existed for its idempotency key. */
  replayed: boolean;
}

/**
 * Completes an inner query that selects `workout_entries` rows (id, user_id, exercise_id,
 * performed_on, created_at, plus any column `orderBy` needs) with the exercise name and the
 * sets. The inner query filters and limits first, so sets load only for the returned entries.
 * `created_at` keeps its microseconds so it can be used in a pagination cursor.
 */
export function selectEntries(innerSql: string, orderBy: string): string {
  return `
    SELECT p.id, p.user_id, x.name::text AS exercise_name, p.performed_on,
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           s.sets
    FROM (${innerSql}) p
    JOIN exercises x ON x.id = p.exercise_id
    CROSS JOIN LATERAL (
      SELECT coalesce(json_agg(json_build_object(
               'reps', ws.reps, 'weight', ws.weight::text, 'unit', ws.unit, 'weightKg', ws.weight_kg::text)
             ORDER BY ws.set_index), '[]') AS sets
      FROM workout_sets ws
      WHERE ws.entry_id = p.id
    ) s
    ORDER BY ${orderBy}`;
}

function toWorkoutEntry(row: EntryRow): WorkoutEntry {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseName: row.exercise_name,
    performedOn: row.performed_on,
    createdAt: row.created_at,
    sets: row.sets,
  };
}

@Injectable()
export class WorkoutEntriesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Inserts entries and their sets in one transaction, so a bulk request is all-or-nothing.
   * An entry whose idempotency key the user already has is skipped (ADR 0003), and the stored
   * entry is returned instead. A parallel retry waits on the unique index until the first
   * request commits, then takes the same path. If the first request rolls back, the retry inserts.
   */
  async insertEntries(userId: string, entries: readonly NewEntry[]): Promise<InsertResult> {
    return withTransaction(this.pool, async (client) => {
      const insertedIds = await insertEntryRows(client, userId, entries);
      await insertSetRows(
        client,
        entries.filter((entry) => insertedIds.has(entry.id)),
      );
      const keys = entries.map((entry) => entry.idempotencyKey);
      const stored = keys.every((key): key is string => key !== null)
        ? await this.findByIdempotencyKeys(userId, keys, client)
        : await this.findByIds(
            entries.map((entry) => entry.id),
            client,
          );
      return { entries: stored, replayed: insertedIds.size < entries.length };
    });
  }

  /** Entries by id, in the order of `ids`. */
  async findByIds(ids: readonly string[], db: Queryable = this.pool): Promise<WorkoutEntry[]> {
    const { rows } = await db.query<EntryRow>(
      selectEntries(
        `SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at
         FROM workout_entries e
         WHERE e.id = ANY($1::uuid[])`,
        'array_position($1::uuid[], p.id)',
      ),
      [ids],
    );
    return rows.map(toWorkoutEntry);
  }

  /** A user's entries by idempotency key, in the order of `keys`. */
  async findByIdempotencyKeys(
    userId: string,
    keys: readonly string[],
    db: Queryable = this.pool,
  ): Promise<WorkoutEntry[]> {
    const { rows } = await db.query<EntryRow>(
      selectEntries(
        `SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at, e.idempotency_key
         FROM workout_entries e
         WHERE e.user_id = $1::uuid AND e.idempotency_key = ANY($2::text[])`,
        'array_position($2::text[], p.idempotency_key)',
      ),
      [userId, keys],
    );
    return rows.map(toWorkoutEntry);
  }
}

/** One multi-row INSERT that skips idempotency keys the user already has. Returns the ids inserted. */
async function insertEntryRows(
  client: PoolClient,
  userId: string,
  entries: readonly NewEntry[],
): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO workout_entries
       (id, user_id, exercise_id, performed_on, idempotency_key, best_weight_kg, best_volume_kg, best_e1rm_kg)
     SELECT t.id, $1::uuid, t.exercise_id, t.performed_on, t.idempotency_key,
            t.best_weight_kg, t.best_volume_kg, t.best_e1rm_kg
     FROM unnest($2::uuid[], $3::uuid[], $4::date[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[])
       AS t (id, exercise_id, performed_on, idempotency_key, best_weight_kg, best_volume_kg, best_e1rm_kg)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      userId,
      entries.map((entry) => entry.id),
      entries.map((entry) => entry.exerciseId),
      entries.map((entry) => entry.performedOn),
      entries.map((entry) => entry.idempotencyKey),
      entries.map((entry) => entry.summary.bestWeightKg.toFixed()),
      entries.map((entry) => entry.summary.bestVolumeKg.toFixed()),
      entries.map((entry) => entry.summary.bestE1rmKg.toFixed()),
    ],
  );
  return new Set(rows.map((row) => row.id));
}

/** One multi-row INSERT for every set of the given entries. */
async function insertSetRows(client: PoolClient, entries: readonly NewEntry[]): Promise<void> {
  const rows = entries.flatMap((entry) =>
    entry.sets.map((set, setIndex) => ({ entryId: entry.id, setIndex, ...set })),
  );
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO workout_sets (entry_id, set_index, reps, weight, unit, weight_kg)
     SELECT * FROM unnest($1::uuid[], $2::smallint[], $3::int[], $4::numeric[], $5::text[], $6::numeric[])`,
    [
      rows.map((row) => row.entryId),
      rows.map((row) => row.setIndex),
      rows.map((row) => row.reps),
      rows.map((row) => row.weight.toFixed()),
      rows.map((row) => row.unit),
      rows.map((row) => row.weightKg.toFixed()),
    ],
  );
}
```

- [ ] **Step 8: Replace the service and controller**

`src/workouts/workout-entries.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../common/clock.js';
import { type FieldError, RequestValidationError } from '../common/errors/request-validation.error.js';
import { summarizeSets } from '../domain/set-metrics.js';
import { convertWeight, roundForStorage } from '../domain/weight-units.js';
import { latestAllowedWorkoutDate } from '../domain/workout-date.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { entryIdempotencyKey } from './idempotency-key.js';
import { type InsertResult, WorkoutEntriesRepository } from './workout-entries.repository.js';
import type { LogEntriesBody, LogEntryInput } from './workout-entries.schemas.js';
import type { NewEntry } from './workout-entry.js';

@Injectable()
export class WorkoutEntriesService {
  constructor(
    private readonly entries: WorkoutEntriesRepository,
    private readonly exercises: ExercisesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Logs one or more entries for a user. Every entry is checked first and all problems are
   * reported together; then everything is written in one transaction (all-or-nothing, ADR 0004).
   * With an idempotency key, a retry returns the entries stored the first time (ADR 0003).
   */
  async logEntries(userId: string, body: LogEntriesBody, idempotencyKey?: string): Promise<InsertResult> {
    const exercises = await this.exercises.resolveNames(body.entries.map((entry) => entry.exerciseName));
    const latestDate = latestAllowedWorkoutDate(this.clock.now());
    const errors: FieldError[] = [];
    const newEntries: NewEntry[] = [];
    body.entries.forEach((entry, index) => {
      if (entry.date > latestDate) {
        errors.push({
          field: `entries[${index}].date`,
          message: `date must not be after ${latestDate} (more than one day in the future)`,
        });
      }
      const exercise = exercises.get(exerciseKey(entry.exerciseName));
      if (exercise === undefined) {
        errors.push(unknownExercise(`entries[${index}].exerciseName`, entry.exerciseName));
      } else {
        const key = idempotencyKey === undefined ? null : entryIdempotencyKey(idempotencyKey, index);
        newEntries.push(toNewEntry(entry, exercise, key));
      }
    });
    if (errors.length > 0) throw new RequestValidationError(errors);
    return this.entries.insertEntries(userId, newEntries);
  }
}

/** Normalizes weights to kilograms and computes the per-entry PR summary (ADR 0001). */
function toNewEntry(entry: LogEntryInput, exercise: ExerciseRef, idempotencyKey: string | null): NewEntry {
  const sets = entry.sets.map((set) => {
    const weight = roundForStorage(new Decimal(set.weight));
    return {
      reps: set.reps,
      weight,
      unit: set.unit,
      weightKg: roundForStorage(convertWeight(weight, set.unit, 'kg')),
    };
  });
  return {
    id: randomUUID(),
    exerciseId: exercise.id,
    performedOn: entry.date,
    idempotencyKey,
    summary: summarizeSets(sets),
    sets,
  };
}
```

`src/workouts/workout-entries.controller.ts`:

```ts
import { Body, Controller, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { parseIdempotencyKey } from './idempotency-key.js';
import { type LogEntriesBody, logEntriesBodySchema } from './workout-entries.schemas.js';
import { WorkoutEntriesService } from './workout-entries.service.js';
import { type EntryResponse, presentEntry } from './workout-entry.presenter.js';

@Controller('users/:userId/workout-entries')
export class WorkoutEntriesController {
  constructor(private readonly service: WorkoutEntriesService) {}

  /**
   * Logs one or more exercise entries for a user; a bulk request is all-or-nothing.
   * With an Idempotency-Key header, a retry returns the original entries and the header
   * `Idempotent-Replayed: true`.
   */
  @Post()
  async log(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Body(new ZodValidationPipe(logEntriesBodySchema)) body: LogEntriesBody,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: EntryResponse[] }> {
    const result = await this.service.logEntries(userId, body, parseIdempotencyKey(rawIdempotencyKey));
    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return { data: result.entries.map((entry) => presentEntry(entry)) };
  }
}
```

- [ ] **Step 9: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass, including the Task 7 logging tests.

- [ ] **Step 10: Commit**

```bash
git add src/workouts test/idempotency.e2e-spec.ts
git commit -m "feat: make retries idempotent with per-entry keys (ADR 0003)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Workout history (filters, unit conversion, cursor pagination)

**Files:**
- Create: `src/workouts/history-cursor.ts`
- Modify: `src/workouts/workout-entries.schemas.ts` (append the history query schema), `src/workouts/workout-entries.repository.ts` (append the history query builder and method), `src/workouts/workout-entries.service.ts` (add `history`), `src/workouts/workout-entry.presenter.ts` (append `HistoryResponse`), `src/workouts/workout-entries.controller.ts` (whole file below)
- Test: `src/workouts/history-cursor.spec.ts`, `test/history.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 4–8 (`plainDateSchema`, `weightUnitSchema`, `exerciseNameSchema`, `requiredError`, `ExercisesRepository.findIds`, `listMuscleGroups`, `selectEntries`, `presentEntry`).
- Produces:
  - `interface HistoryCursor { performedOn: string; createdAt: string; id: string }`, `encodeCursor(cursor): string`, `decodeCursor(raw: string): HistoryCursor | null`
  - `historyQuerySchema`, `type HistoryQuery` (`exerciseName?`, `muscleGroup?`, `from?`, `to?`, `unit?: WeightUnit`, `limit: number`, `cursor?: HistoryCursor`), `HISTORY_DEFAULT_LIMIT = 20`, `HISTORY_MAX_LIMIT = 100`
  - `interface HistoryFilter { userId; exerciseIds?: readonly string[]; from?; to?; after?: HistoryCursor; limit: number }`, `buildHistoryQuery(filter): { text: string; values: unknown[] }` (exported for the Task 12 EXPLAIN test), `WorkoutEntriesRepository.findHistoryPage(filter): Promise<WorkoutEntry[]>`
  - `interface HistoryPage { entries: WorkoutEntry[]; nextCursor: string | null }`, `WorkoutEntriesService.history(userId, query): Promise<HistoryPage>`
  - `interface HistoryResponse { data: EntryResponse[]; page: { limit: number; nextCursor: string | null }; message?: string }`
  - `GET /users/:userId/workout-entries`

- [ ] **Step 1: Write the failing cursor test**

`src/workouts/history-cursor.spec.ts`:

```ts
import { decodeCursor, encodeCursor } from './history-cursor.js';

const cursor = {
  performedOn: '2026-10-14',
  createdAt: '2026-10-15T09:09:08.404114Z',
  id: '86576499-296e-4c44-bb4e-57e950b9eb57',
};

describe('history cursor', () => {
  it('round-trips, keeping microseconds', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is URL-safe', () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    '',
    'not-base64!',
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('["2026-10-14","yesterday","x"]').toString('base64url'),
  ])('rejects %j', (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/workouts/history-cursor.spec.ts`
Expected: FAIL. `./history-cursor.js` cannot be resolved.

- [ ] **Step 3: Implement `src/workouts/history-cursor.ts`**

```ts
import { z } from 'zod';

/** Position after the last entry of a page, in history order (performed_on, created_at, id). */
export interface HistoryCursor {
  performedOn: string;
  createdAt: string;
  id: string;
}

const cursorTuple = z.tuple([z.iso.date(), z.iso.datetime(), z.guid()]);

/** Opaque, URL-safe cursor: base64url of a JSON tuple. */
export function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify([cursor.performedOn, cursor.createdAt, cursor.id])).toString('base64url');
}

/** Returns null for anything that is not a cursor produced by `encodeCursor`. */
export function decodeCursor(raw: string): HistoryCursor | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = cursorTuple.safeParse(decoded);
  if (!parsed.success) return null;
  const [performedOn, createdAt, id] = parsed.data;
  return { performedOn, createdAt, id };
}
```

Run: `npm test -- src/workouts/history-cursor.spec.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing history e2e test**

`test/history.e2e-spec.ts`:

```ts
import request from 'supertest';
import { entriesOf, entry, logOk, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

interface InvalidQueryCase {
  name: string;
  query: Record<string, string | number>;
  field: string;
  message: string;
}

describe('GET /users/:userId/workout-entries', () => {
  let t: TestApp;

  const get = (userId: string, query: Record<string, string | number> = {}) =>
    request(t.app.getHttpServer()).get(`/users/${userId}/workout-entries`).query(query);
  const log = (entries: unknown[], userId = USER_A) => logOk(t.app, userId, entries);

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it("lists the user's entries newest first; within a day, most recently logged first", async () => {
    await log([entry('2026-10-01', 'Deadlift')]);
    await log([entry('2026-10-03', 'Bench Press')]);
    await log([entry('2026-10-01', 'Back Squat')]);
    await log([entry('2026-10-05', 'Pull-Up')], USER_B);
    const res = await get(USER_A);
    expect(res.status).toBe(200);
    expect(entriesOf(res).map((e) => [e.date, e.exerciseName])).toEqual([
      ['2026-10-03', 'Bench Press'],
      ['2026-10-01', 'Back Squat'],
      ['2026-10-01', 'Deadlift'],
    ]);
    expect(res.body.page).toEqual({ limit: 20, nextCursor: null });
    expect(res.body).not.toHaveProperty('message');
  });

  it('filters by partial exercise name, case-insensitively', async () => {
    await log([entry('2026-10-01', 'Back Squat'), entry('2026-10-02', 'Front Squat'), entry('2026-10-03', 'Deadlift')]);
    expect(entriesOf(await get(USER_A, { exerciseName: 'SQUAT' })).map((e) => e.exerciseName)).toEqual([
      'Front Squat',
      'Back Squat',
    ]);
  });

  it('treats % and _ in the exercise name filter literally', async () => {
    await log([entry('2026-10-01', 'Back Squat')]);
    for (const pattern of ['%', '_']) {
      const res = await get(USER_A, { exerciseName: pattern });
      expect(res.status).toBe(200);
      expect(entriesOf(res)).toEqual([]);
    }
  });

  it('filters by muscle group through the exercise mapping', async () => {
    await log([entry('2026-10-01', 'Bench Press'), entry('2026-10-02', 'Deadlift'), entry('2026-10-03', 'Pull-Up')]);
    expect(entriesOf(await get(USER_A, { muscleGroup: 'Back' })).map((e) => e.exerciseName)).toEqual([
      'Pull-Up',
      'Deadlift',
    ]);
  });

  it('follows changes to the muscle-group mapping without touching stored entries', async () => {
    await log([entry('2026-10-01', 'Calf Raise')]);
    expect(entriesOf(await get(USER_A, { muscleGroup: 'core' }))).toEqual([]);
    await t.pool.query(
      `INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id)
       SELECT e.id, m.id FROM exercises e, muscle_groups m WHERE e.name = 'Calf Raise' AND m.name = 'core'`,
    );
    try {
      expect(entriesOf(await get(USER_A, { muscleGroup: 'core' })).map((e) => e.exerciseName)).toEqual(['Calf Raise']);
    } finally {
      await t.pool.query(
        `DELETE FROM exercise_muscle_groups em USING exercises e, muscle_groups m
         WHERE em.exercise_id = e.id AND em.muscle_group_id = m.id AND e.name = 'Calf Raise' AND m.name = 'core'`,
      );
    }
  });

  it('rejects an unknown muscle group and lists the valid ones', async () => {
    const res = await get(USER_A, { muscleGroup: 'wings' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      {
        field: 'muscleGroup',
        message:
          'Unknown muscle group "wings". Valid muscle groups: back, biceps, calves, chest, core, glutes, hamstrings, quadriceps, shoulders, triceps',
      },
    ]);
  });

  it('filters by an inclusive date range', async () => {
    await log(['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-16'].map((date) => entry(date, 'Deadlift')));
    expect(entriesOf(await get(USER_A, { from: '2026-10-01', to: '2026-10-15' })).map((e) => e.date)).toEqual([
      '2026-10-15',
      '2026-10-01',
    ]);
  });

  it('returns an empty list with a message for a range without data', async () => {
    await log([entry('2026-10-01', 'Deadlift')]);
    const res = await get(USER_A, { from: '2025-01-01', to: '2025-01-31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      page: { limit: 20, nextCursor: null },
      message: 'No workout entries match the given filters.',
    });
  });

  it('converts weights to the requested unit and keeps sets already in that unit exact', async () => {
    await log([entry('2026-10-01', 'Bench Press', [set(5, 100, 'kg'), set(5, 225, 'lb')])]);
    expect(entriesOf(await get(USER_A, { unit: 'lb' }))[0].sets).toEqual([
      { reps: 5, weight: 220.46, unit: 'lb' },
      { reps: 5, weight: 225, unit: 'lb' },
    ]);
    expect(entriesOf(await get(USER_A, { unit: 'KG' }))[0].sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 5, weight: 102.06, unit: 'kg' },
    ]);
    expect(entriesOf(await get(USER_A))[0].sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 5, weight: 225, unit: 'lb' },
    ]);
  });

  it('pages through entries that share a day and a timestamp without gaps or repeats', async () => {
    // One bulk request: all 25 entries share performed_on and created_at, so only id breaks ties.
    const logged = await log(Array.from({ length: 25 }, () => entry('2026-10-10', 'Bench Press')));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(USER_A, cursor === null ? { limit: 10 } : { limit: 10, cursor });
      expect(res.status).toBe(200);
      seen.push(...entriesOf(res).map((e) => e.id));
      cursor = res.body.page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen)).toEqual(new Set(logged.map((e) => e.id)));
  });

  it('combines filters with pagination', async () => {
    await log(Array.from({ length: 3 }, (_, i) => entry(`2026-10-0${i + 1}`, 'Bench Press')));
    await log([entry('2026-10-02', 'Deadlift')]);
    const first = await get(USER_A, { exerciseName: 'bench', limit: 2 });
    expect(entriesOf(first).map((e) => e.date)).toEqual(['2026-10-03', '2026-10-02']);
    const second = await get(USER_A, { exerciseName: 'bench', limit: 2, cursor: first.body.page.nextCursor });
    expect(entriesOf(second).map((e) => e.date)).toEqual(['2026-10-01']);
    expect(second.body.page.nextCursor).toBeNull();
  });

  const invalidQueries: InvalidQueryCase[] = [
    { name: 'limit 0', query: { limit: 0 }, field: 'limit', message: 'limit must be at least 1' },
    { name: 'limit 101', query: { limit: 101 }, field: 'limit', message: 'limit must be at most 100' },
    { name: 'a non-numeric limit', query: { limit: 'ten' }, field: 'limit', message: 'limit must be a number' },
    {
      name: 'a reversed range',
      query: { from: '2026-10-05', to: '2026-10-01' },
      field: 'from',
      message: 'from must be on or before to',
    },
    {
      name: 'a non-ISO date',
      query: { from: '01/10/2026' },
      field: 'from',
      message: 'from must be a date in YYYY-MM-DD format',
    },
    {
      name: 'an unsupported unit',
      query: { unit: 'stone' },
      field: 'unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
    {
      name: 'a garbage cursor',
      query: { cursor: 'garbage' },
      field: 'cursor',
      message: 'cursor is invalid; use nextCursor from the previous page',
    },
    { name: 'a misspelled parameter', query: { exercise: 'bench' }, field: 'query', message: 'Unrecognized key: "exercise"' },
  ];

  it.each(invalidQueries)('rejects $name', async ({ query, field, message }) => {
    const res = await get(USER_A, query);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('rejects a repeated query parameter', async () => {
    const res = await request(t.app.getHttpServer()).get(`/users/${USER_A}/workout-entries?unit=kg&unit=lb`);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'unit', message: 'unit must be a string' }]);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/history.e2e-spec.ts`
Expected: FAIL with 404 `Cannot GET /users/…/workout-entries`.

- [ ] **Step 6: Append the history query schema**

Add to the imports of `src/workouts/workout-entries.schemas.ts`:

```ts
import { plainDateSchema } from '../common/validation/schemas.js';
import { decodeCursor } from './history-cursor.js';
```

(Merge `plainDateSchema` into the existing `../common/validation/schemas.js` import line.) Then append:

```ts
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 100;

export const historyQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema().optional(),
    muscleGroup: z
      .string(requiredError('muscleGroup', 'a string'))
      .trim()
      .min(1, 'muscleGroup must not be empty')
      .optional(),
    from: plainDateSchema('from').optional(),
    to: plainDateSchema('to').optional(),
    unit: weightUnitSchema.optional(),
    limit: z.coerce
      .number({ error: 'limit must be a number' })
      .int('limit must be a whole number')
      .min(1, 'limit must be at least 1')
      .max(HISTORY_MAX_LIMIT, `limit must be at most ${HISTORY_MAX_LIMIT}`)
      .default(HISTORY_DEFAULT_LIMIT),
    cursor: z
      .string(requiredError('cursor', 'a string'))
      .transform((value, ctx) => {
        const cursor = decodeCursor(value);
        if (cursor) return cursor;
        ctx.addIssue({ code: 'custom', message: 'cursor is invalid; use nextCursor from the previous page' });
        return z.NEVER;
      })
      .optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type HistoryQuery = z.output<typeof historyQuerySchema>;
```

- [ ] **Step 7: Append the history query to the repository**

Add to the imports of `src/workouts/workout-entries.repository.ts`:

```ts
import type { HistoryCursor } from './history-cursor.js';
```

Add after `toWorkoutEntry`:

```ts
export interface HistoryFilter {
  userId: string;
  /** Only these exercises; undefined means every exercise. */
  exerciseIds?: readonly string[];
  /** Inclusive bounds on performed_on. */
  from?: string;
  to?: string;
  /** Return entries strictly after this position in history order. */
  after?: HistoryCursor;
  limit: number;
}

/**
 * History page, newest first (performed_on DESC, created_at DESC, id DESC; ADR 0002), with
 * keyset pagination. Postgres evaluates the cursor's row comparison inside
 * `workout_entries_history_idx`, so a deep page costs the same as the first one.
 */
export function buildHistoryQuery(filter: HistoryFilter): { text: string; values: unknown[] } {
  const values: unknown[] = [filter.userId];
  const param = (value: unknown, type: string): string => {
    values.push(value);
    return `$${values.length}::${type}`;
  };
  const conditions = ['e.user_id = $1::uuid'];
  if (filter.exerciseIds !== undefined) conditions.push(`e.exercise_id = ANY(${param(filter.exerciseIds, 'uuid[]')})`);
  if (filter.from !== undefined) conditions.push(`e.performed_on >= ${param(filter.from, 'date')}`);
  if (filter.to !== undefined) conditions.push(`e.performed_on <= ${param(filter.to, 'date')}`);
  if (filter.after !== undefined) {
    const { performedOn, createdAt, id } = filter.after;
    conditions.push(
      `(e.performed_on, e.created_at, e.id) < (${param(performedOn, 'date')}, ${param(createdAt, 'timestamptz')}, ${param(id, 'uuid')})`,
    );
  }
  const page = `
    SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at
    FROM workout_entries e
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.performed_on DESC, e.created_at DESC, e.id DESC
    LIMIT ${param(filter.limit, 'int')}`;
  return { text: selectEntries(page, 'p.performed_on DESC, p.created_at DESC, p.id DESC'), values };
}
```

Add this method to the `WorkoutEntriesRepository` class:

```ts
  async findHistoryPage(filter: HistoryFilter): Promise<WorkoutEntry[]> {
    const { text, values } = buildHistoryQuery(filter);
    const { rows } = await this.pool.query<EntryRow>(text, values);
    return rows.map(toWorkoutEntry);
  }
```

- [ ] **Step 8: Add `history` to the service**

Add to the imports of `src/workouts/workout-entries.service.ts`:

```ts
import { encodeCursor } from './history-cursor.js';
import type { HistoryQuery } from './workout-entries.schemas.js';
import type { WorkoutEntry } from './workout-entry.js';
```

(Merge them into the existing import lines from `./workout-entries.schemas.js` and `./workout-entry.js`.) Add this interface above the class:

```ts
export interface HistoryPage {
  entries: WorkoutEntry[];
  /** Cursor for the next page, or null on the last page. */
  nextCursor: string | null;
}
```

Add these methods to the class:

```ts
  /** One page of a user's history, newest first, with optional exercise, muscle group and date filters. */
  async history(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    if (query.muscleGroup !== undefined) {
      await this.assertKnownMuscleGroup(query.muscleGroup);
    }
    let exerciseIds: string[] | undefined;
    if (query.exerciseName !== undefined || query.muscleGroup !== undefined) {
      // Resolve the filters on the small exercises table first, then scan only the user's entries.
      exerciseIds = await this.exercises.findIds({ nameContains: query.exerciseName, muscleGroup: query.muscleGroup });
      if (exerciseIds.length === 0) return { entries: [], nextCursor: null };
    }
    const rows = await this.entries.findHistoryPage({
      userId,
      exerciseIds,
      from: query.from,
      to: query.to,
      after: query.cursor,
      limit: query.limit + 1, // one extra row tells us whether another page exists
    });
    const entries = rows.slice(0, query.limit);
    const last = entries.at(-1);
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ performedOn: last.performedOn, createdAt: last.createdAt, id: last.id })
        : null;
    return { entries, nextCursor };
  }

  private async assertKnownMuscleGroup(name: string): Promise<void> {
    const groups = await this.exercises.listMuscleGroups();
    if (!groups.some((group) => group.toLowerCase() === name.toLowerCase())) {
      throw new RequestValidationError([
        { field: 'muscleGroup', message: `Unknown muscle group "${name}". Valid muscle groups: ${groups.join(', ')}` },
      ]);
    }
  }
```

- [ ] **Step 9: Add the response type and the GET route**

Append to `src/workouts/workout-entry.presenter.ts`:

```ts
export interface HistoryResponse {
  data: EntryResponse[];
  page: { limit: number; nextCursor: string | null };
  /** Present only when the page is empty. */
  message?: string;
}
```

Replace `src/workouts/workout-entries.controller.ts`:

```ts
import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { parseIdempotencyKey } from './idempotency-key.js';
import {
  type HistoryQuery,
  type LogEntriesBody,
  historyQuerySchema,
  logEntriesBodySchema,
} from './workout-entries.schemas.js';
import { WorkoutEntriesService } from './workout-entries.service.js';
import { type EntryResponse, type HistoryResponse, presentEntry } from './workout-entry.presenter.js';

@Controller('users/:userId/workout-entries')
export class WorkoutEntriesController {
  constructor(private readonly service: WorkoutEntriesService) {}

  /**
   * Logs one or more exercise entries for a user; a bulk request is all-or-nothing.
   * With an Idempotency-Key header, a retry returns the original entries and the header
   * `Idempotent-Replayed: true`.
   */
  @Post()
  async log(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Body(new ZodValidationPipe(logEntriesBodySchema)) body: LogEntriesBody,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: EntryResponse[] }> {
    const result = await this.service.logEntries(userId, body, parseIdempotencyKey(rawIdempotencyKey));
    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return { data: result.entries.map((entry) => presentEntry(entry)) };
  }

  /** A user's entries, newest first, filtered and paginated with an opaque cursor. */
  @Get()
  async history(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
  ): Promise<HistoryResponse> {
    const page = await this.service.history(userId, query);
    return {
      data: page.entries.map((entry) => presentEntry(entry, query.unit)),
      page: { limit: query.limit, nextCursor: page.nextCursor },
      ...(page.entries.length === 0 ? { message: 'No workout entries match the given filters.' } : {}),
    };
  }
}
```

- [ ] **Step 10: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/workouts test/history.e2e-spec.ts
git commit -m "feat: add workout history with filters, unit conversion and keyset pagination" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Personal records

**Files:**
- Create: `src/personal-records/personal-records.ts`, `src/personal-records/personal-records.schemas.ts`, `src/personal-records/personal-records.repository.ts`, `src/personal-records/personal-records.service.ts`, `src/personal-records/personal-records.controller.ts`, `src/personal-records/personal-records.module.ts`
- Modify: `src/app.module.ts` (import `PersonalRecordsModule`)
- Test: `src/personal-records/personal-records.spec.ts`, `test/personal-records.e2e-spec.ts`

**Interfaces:**
- Consumes: `setVolume`, `epleyOneRepMax` (Task 2); `convertWeight`, `roundForDisplay`, `WeightUnit` (Task 2); schemas and pipe (Task 4); `PG_POOL` (Task 5); `ExercisesModule`, `ExercisesRepository`, `ExerciseRef`, `exerciseKey`, `unknownExercise` (Task 6).
- Produces:
  - `PR_METRICS = ['maxWeight', 'maxVolume', 'bestE1rm'] as const`, `type PrMetric`, `interface RecordRow { metric; entryId; performedOn; reps; weight: string; unit: WeightUnit }`, `interface PersonalRecord { value: Decimal; weight: Decimal; reps; date; entryId }`, `type PersonalRecords = Record<PrMetric, PersonalRecord | null>`
  - `toPersonalRecords(rows, unit): PersonalRecords`, `hasAnyRecord(records): boolean`, `presentRecords(records): RecordsResponse`, `interface RecordResponse { value: number; weight: number; reps; date; entryId }`, `type RecordsResponse`, `interface PersonalRecordsResponse`
  - `personalRecordsQuerySchema`, `type PersonalRecordsQuery` (`exerciseName`, `unit` (default `kg`), `from?`, `to?`)
  - `interface RecordQuery { userId; exerciseId; from?; to? }`, `buildPersonalRecordsQuery(query): { text; values }` (exported for Task 12), `PersonalRecordsRepository.findRecordRows(query): Promise<RecordRow[]>`
  - `PersonalRecordsService.getRecords(userId, query): Promise<{ exercise: ExerciseRef; records: PersonalRecords }>` and the private `resolveExercise(name)`
  - `GET /users/:userId/personal-records`

- [ ] **Step 1: Write the failing record-math test**

`src/personal-records/personal-records.spec.ts`:

```ts
import type { WeightUnit } from '../domain/weight-units.js';
import { type PrMetric, type RecordRow, hasAnyRecord, presentRecords, toPersonalRecords } from './personal-records.js';

const row = (metric: PrMetric, reps: number, weight: string, unit: WeightUnit = 'kg'): RecordRow => ({
  metric,
  entryId: `entry-${metric}`,
  performedOn: '2026-10-10',
  reps,
  weight,
  unit,
});

describe('toPersonalRecords', () => {
  it('computes each metric from the set that holds it', () => {
    const rows = [row('maxWeight', 1, '140.000'), row('maxVolume', 10, '100.000'), row('bestE1rm', 5, '130.000')];
    expect(presentRecords(toPersonalRecords(rows, 'kg'))).toEqual({
      maxWeight: { value: 140, weight: 140, reps: 1, date: '2026-10-10', entryId: 'entry-maxWeight' },
      maxVolume: { value: 1000, weight: 100, reps: 10, date: '2026-10-10', entryId: 'entry-maxVolume' },
      bestE1rm: { value: 151.67, weight: 130, reps: 5, date: '2026-10-10', entryId: 'entry-bestE1rm' },
    });
  });

  it('converts from the logged unit and keeps same-unit values exact', () => {
    const rows = [row('maxWeight', 1, '315.000', 'lb')];
    expect(presentRecords(toPersonalRecords(rows, 'lb')).maxWeight?.value).toBe(315);
    expect(presentRecords(toPersonalRecords(rows, 'kg')).maxWeight?.value).toBe(142.88);
  });

  it('leaves metrics without data as null', () => {
    const records = toPersonalRecords([], 'kg');
    expect(records).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(hasAnyRecord(records)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/personal-records`
Expected: FAIL. `./personal-records.js` cannot be resolved.

- [ ] **Step 3: Implement `src/personal-records/personal-records.ts`**

```ts
import type { Decimal } from 'decimal.js';
import { epleyOneRepMax, setVolume } from '../domain/set-metrics.js';
import { type WeightUnit, convertWeight, roundForDisplay } from '../domain/weight-units.js';

export const PR_METRICS = ['maxWeight', 'maxVolume', 'bestE1rm'] as const;
export type PrMetric = (typeof PR_METRICS)[number];

/** The set that holds a record, as stored: its logged weight and unit. */
export interface RecordRow {
  metric: PrMetric;
  entryId: string;
  performedOn: string;
  reps: number;
  weight: string;
  unit: WeightUnit;
}

export interface PersonalRecord {
  /** The metric's value in the requested unit. */
  value: Decimal;
  weight: Decimal;
  reps: number;
  /** The day the record was first reached. */
  date: string;
  entryId: string;
}

export type PersonalRecords = Record<PrMetric, PersonalRecord | null>;

export interface RecordResponse {
  value: number;
  weight: number;
  reps: number;
  date: string;
  entryId: string;
}

export type RecordsResponse = Record<PrMetric, RecordResponse | null>;

export interface PersonalRecordsResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    from: string | null;
    to: string | null;
    records: RecordsResponse;
  };
  /** Present only when there are no records. */
  message?: string;
}

/** Builds each record in the requested unit from the set that holds it. Metrics without data stay null. */
export function toPersonalRecords(rows: readonly RecordRow[], unit: WeightUnit): PersonalRecords {
  const records: PersonalRecords = { maxWeight: null, maxVolume: null, bestE1rm: null };
  for (const row of rows) {
    const weight = convertWeight(row.weight, row.unit, unit);
    records[row.metric] = {
      value: metricValue(row.metric, row.reps, weight),
      weight,
      reps: row.reps,
      date: row.performedOn,
      entryId: row.entryId,
    };
  }
  return records;
}

export function hasAnyRecord(records: PersonalRecords): boolean {
  return PR_METRICS.some((metric) => records[metric] !== null);
}

export function presentRecords(records: PersonalRecords): RecordsResponse {
  const present = (record: PersonalRecord | null): RecordResponse | null =>
    record && {
      value: roundForDisplay(record.value),
      weight: roundForDisplay(record.weight),
      reps: record.reps,
      date: record.date,
      entryId: record.entryId,
    };
  return {
    maxWeight: present(records.maxWeight),
    maxVolume: present(records.maxVolume),
    bestE1rm: present(records.bestE1rm),
  };
}

function metricValue(metric: PrMetric, reps: number, weight: Decimal): Decimal {
  switch (metric) {
    case 'maxWeight':
      return weight;
    case 'maxVolume':
      return setVolume(reps, weight);
    case 'bestE1rm':
      return epleyOneRepMax(reps, weight);
  }
}
```

Run: `npm test -- src/personal-records`
Expected: PASS.

- [ ] **Step 4: Write the failing records e2e test**

`test/personal-records.e2e-spec.ts`:

```ts
import request from 'supertest';
import { entry, logOk, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

interface InvalidQueryCase {
  name: string;
  query: Record<string, string>;
  field: string;
  message: string;
}

describe('GET /users/:userId/personal-records', () => {
  let t: TestApp;

  const getRecords = (query: Record<string, string>, userId = USER_A) =>
    request(t.app.getHttpServer()).get(`/users/${userId}/personal-records`).query(query);
  const log = (entries: unknown[], userId = USER_A) => logOk(t.app, userId, entries);

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('returns the heaviest set, highest-volume set and best e1RM with their dates', async () => {
    await log([entry('2026-09-02', 'Bench Press', [set(1, 120), set(10, 80)])]);
    await log([entry('2026-09-09', 'Bench Press', [set(5, 110)])]);
    await log([entry('2026-09-09', 'Deadlift', [set(1, 200)])]);
    const res = await getRecords({ exerciseName: 'bench press' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        exerciseName: 'Bench Press',
        unit: 'kg',
        from: null,
        to: null,
        records: {
          maxWeight: { value: 120, weight: 120, reps: 1, date: '2026-09-02', entryId: expect.any(String) },
          maxVolume: { value: 800, weight: 80, reps: 10, date: '2026-09-02', entryId: expect.any(String) },
          bestE1rm: { value: 128.33, weight: 110, reps: 5, date: '2026-09-09', entryId: expect.any(String) },
        },
      },
    });
  });

  it('dates a record by the first time it was reached', async () => {
    await log([entry('2026-09-01', 'Bench Press', [set(3, 100)])]);
    await log([entry('2026-09-15', 'Bench Press', [set(3, 100)])]);
    const res = await getRecords({ exerciseName: 'Bench Press' });
    expect(res.body.data.records.maxWeight.date).toBe('2026-09-01');
  });

  it('compares weights across units by their kilogram value', async () => {
    await log([entry('2026-09-01', 'Deadlift', [set(1, 200, 'lb')])]); // 90.72 kg
    await log([entry('2026-09-02', 'Deadlift', [set(1, 100, 'kg')])]); // heavier, although 100 < 200
    const kg = await getRecords({ exerciseName: 'Deadlift' });
    expect(kg.body.data.records.maxWeight).toMatchObject({ value: 100, date: '2026-09-02' });
    const lb = await getRecords({ exerciseName: 'Deadlift', unit: 'lb' });
    expect(lb.body.data).toMatchObject({ unit: 'lb', records: { maxWeight: { value: 220.46, weight: 220.46 } } });
  });

  it('limits records to an inclusive date range', async () => {
    await log([entry('2026-08-31', 'Bench Press', [set(1, 130)])]);
    await log([entry('2026-09-01', 'Bench Press', [set(1, 110)])]);
    await log([entry('2026-09-30', 'Bench Press', [set(1, 115)])]);
    await log([entry('2026-10-01', 'Bench Press', [set(1, 140)])]);
    const res = await getRecords({ exerciseName: 'Bench Press', from: '2026-09-01', to: '2026-09-30' });
    expect(res.body.data).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      records: { maxWeight: { value: 115, date: '2026-09-30' } },
    });
  });

  it("only uses the requested user's entries", async () => {
    await log([entry('2026-09-01', 'Deadlift', [set(1, 250)])], USER_B);
    await log([entry('2026-09-01', 'Deadlift', [set(1, 180)])]);
    const res = await getRecords({ exerciseName: 'Deadlift' });
    expect(res.body.data.records.maxWeight.value).toBe(180);
  });

  it('returns empty records with a message when there is no data', async () => {
    const res = await getRecords({ exerciseName: 'Deadlift', from: '2026-01-01', to: '2026-01-31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        exerciseName: 'Deadlift',
        unit: 'kg',
        from: '2026-01-01',
        to: '2026-01-31',
        records: { maxWeight: null, maxVolume: null, bestE1rm: null },
      },
      message: 'No Deadlift entries found for this user in the given date range.',
    });
  });

  const invalidQueries: InvalidQueryCase[] = [
    { name: 'a missing exercise name', query: {}, field: 'exerciseName', message: 'exerciseName is required' },
    {
      name: 'an unknown exercise',
      query: { exerciseName: 'Benchpress' },
      field: 'exerciseName',
      message: 'Unknown exercise "Benchpress". GET /exercises lists the valid names',
    },
    {
      name: 'a reversed range',
      query: { exerciseName: 'Bench Press', from: '2026-10-02', to: '2026-10-01' },
      field: 'from',
      message: 'from must be on or before to',
    },
    {
      name: 'an unsupported unit',
      query: { exerciseName: 'Bench Press', unit: 'stone' },
      field: 'unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
  ];

  it.each(invalidQueries)('rejects $name', async ({ query, field, message }) => {
    const res = await getRecords(query);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/personal-records.e2e-spec.ts`
Expected: FAIL with 404 `Cannot GET /users/…/personal-records`.

- [ ] **Step 6: Implement the schema, repository, service, controller and module**

`src/personal-records/personal-records.schemas.ts`:

```ts
import { z } from 'zod';
import { exerciseNameSchema, plainDateSchema, weightUnitSchema } from '../common/validation/schemas.js';

export const personalRecordsQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema(),
    unit: weightUnitSchema.default('kg'),
    from: plainDateSchema('from').optional(),
    to: plainDateSchema('to').optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type PersonalRecordsQuery = z.output<typeof personalRecordsQuerySchema>;
```

`src/personal-records/personal-records.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import type { WeightUnit } from '../domain/weight-units.js';
import { PR_METRICS, type PrMetric, type RecordRow } from './personal-records.js';

export interface RecordQuery {
  userId: string;
  exerciseId: string;
  /** Inclusive bounds on performed_on; omitted means unbounded. */
  from?: string;
  to?: string;
}

/**
 * Per metric: the entry summary column that ranks entries, and the order that picks the
 * record set inside the winning entry. Constant SQL fragments only, never user input.
 */
const METRIC_SQL: Record<PrMetric, { column: string; setOrder: string }> = {
  maxWeight: { column: 'best_weight_kg', setOrder: 'ws.weight_kg DESC, ws.reps DESC, ws.set_index' },
  maxVolume: { column: 'best_volume_kg', setOrder: 'ws.reps * ws.weight_kg DESC, ws.weight_kg DESC, ws.set_index' },
  bestE1rm: { column: 'best_e1rm_kg', setOrder: 'ws.weight_kg * (1 + ws.reps / 30.0) DESC, ws.set_index' },
};

/**
 * One round trip, three index lookups. For each metric it finds the user's best entry for the
 * exercise (the earliest on ties, so the date is when the record was first reached), then the
 * set in that entry that produced it. The best_* indexes from ADR 0001 serve every lookup.
 */
export function buildPersonalRecordsQuery(query: RecordQuery): { text: string; values: unknown[] } {
  const values: unknown[] = [query.userId, query.exerciseId];
  const conditions = ['e.user_id = $1::uuid', 'e.exercise_id = $2::uuid'];
  if (query.from !== undefined) {
    values.push(query.from);
    conditions.push(`e.performed_on >= $${values.length}::date`);
  }
  if (query.to !== undefined) {
    values.push(query.to);
    conditions.push(`e.performed_on <= $${values.length}::date`);
  }
  const where = conditions.join(' AND ');
  const perMetric = PR_METRICS.map((metric) => {
    const { column, setOrder } = METRIC_SQL[metric];
    return `(
      SELECT '${metric}' AS metric, best.id AS entry_id, best.performed_on, ws.reps, ws.weight::text AS weight, ws.unit
      FROM (
        SELECT e.id, e.performed_on
        FROM workout_entries e
        WHERE ${where}
        ORDER BY e.${column} DESC, e.performed_on, e.created_at, e.id
        LIMIT 1
      ) best
      CROSS JOIN LATERAL (
        SELECT ws.reps, ws.weight, ws.unit
        FROM workout_sets ws
        WHERE ws.entry_id = best.id
        ORDER BY ${setOrder}
        LIMIT 1
      ) ws
    )`;
  });
  return { text: perMetric.join('\nUNION ALL\n'), values };
}

interface RecordDbRow {
  metric: PrMetric;
  entry_id: string;
  performed_on: string;
  reps: number;
  weight: string;
  unit: WeightUnit;
}

@Injectable()
export class PersonalRecordsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The set holding each record; a metric without data has no row. */
  async findRecordRows(query: RecordQuery): Promise<RecordRow[]> {
    const { text, values } = buildPersonalRecordsQuery(query);
    const { rows } = await this.pool.query<RecordDbRow>(text, values);
    return rows.map((row) => ({
      metric: row.metric,
      entryId: row.entry_id,
      performedOn: row.performed_on,
      reps: row.reps,
      weight: row.weight,
      unit: row.unit,
    }));
  }
}
```

`src/personal-records/personal-records.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { RequestValidationError } from '../common/errors/request-validation.error.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { type PersonalRecords, toPersonalRecords } from './personal-records.js';
import { PersonalRecordsRepository } from './personal-records.repository.js';
import type { PersonalRecordsQuery } from './personal-records.schemas.js';

export interface ExerciseRecords {
  exercise: ExerciseRef;
  records: PersonalRecords;
}

@Injectable()
export class PersonalRecordsService {
  constructor(
    private readonly records: PersonalRecordsRepository,
    private readonly exercises: ExercisesRepository,
  ) {}

  /** A user's records for one exercise, all-time or within an inclusive date range. */
  async getRecords(userId: string, query: PersonalRecordsQuery): Promise<ExerciseRecords> {
    const exercise = await this.resolveExercise(query.exerciseName);
    const rows = await this.records.findRecordRows({
      userId,
      exerciseId: exercise.id,
      from: query.from,
      to: query.to,
    });
    return { exercise, records: toPersonalRecords(rows, query.unit) };
  }

  /** Resolves `exerciseName` in the catalog, or fails with a 400 naming the field (ADR 0004). */
  private async resolveExercise(name: string): Promise<ExerciseRef> {
    const exercise = (await this.exercises.resolveNames([name])).get(exerciseKey(name));
    if (exercise === undefined) {
      throw new RequestValidationError([unknownExercise('exerciseName', name)]);
    }
    return exercise;
  }
}
```

`src/personal-records/personal-records.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { type PersonalRecordsResponse, hasAnyRecord, presentRecords } from './personal-records.js';
import { type PersonalRecordsQuery, personalRecordsQuerySchema } from './personal-records.schemas.js';
import { PersonalRecordsService } from './personal-records.service.js';

@Controller('users/:userId/personal-records')
export class PersonalRecordsController {
  constructor(private readonly service: PersonalRecordsService) {}

  /** Heaviest set, highest-volume set and best estimated 1RM for one exercise, all-time or in a range. */
  @Get()
  async getRecords(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(personalRecordsQuerySchema)) query: PersonalRecordsQuery,
  ): Promise<PersonalRecordsResponse> {
    const { exercise, records } = await this.service.getRecords(userId, query);
    const ranged = query.from !== undefined || query.to !== undefined;
    return {
      data: {
        exerciseName: exercise.name,
        unit: query.unit,
        from: query.from ?? null,
        to: query.to ?? null,
        records: presentRecords(records),
      },
      ...(hasAnyRecord(records)
        ? {}
        : { message: `No ${exercise.name} entries found for this user${ranged ? ' in the given date range' : ''}.` }),
    };
  }
}
```

`src/personal-records/personal-records.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { PersonalRecordsController } from './personal-records.controller.js';
import { PersonalRecordsRepository } from './personal-records.repository.js';
import { PersonalRecordsService } from './personal-records.service.js';

@Module({
  imports: [ExercisesModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService, PersonalRecordsRepository],
})
export class PersonalRecordsModule {}
```

In `src/app.module.ts`, add `import { PersonalRecordsModule } from './personal-records/personal-records.module.js';` and append `PersonalRecordsModule` after `WorkoutsModule` in `imports`.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/personal-records src/app.module.ts test/personal-records.e2e-spec.ts
git commit -m "feat: return personal records (max weight, volume, Epley 1RM) with dates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Personal-record comparison between two periods

**Files:**
- Modify: `src/personal-records/personal-records.ts` (append the comparison), `src/personal-records/personal-records.schemas.ts` (append), `src/personal-records/personal-records.service.ts` (add `compare`), `src/personal-records/personal-records.controller.ts` (add the route)
- Test: `src/personal-records/personal-records.spec.ts` (append), `test/personal-records-comparison.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 10.
- Produces:
  - `interface MetricChange { absolute: number; percent: number | null }`, `type RecordChanges = Record<PrMetric, MetricChange | null>`, `compareRecords(current, baseline): RecordChanges`
  - `interface PeriodRecords { from: string; to: string; records: RecordsResponse }`, `interface RecordsComparisonResponse`
  - `recordsComparisonQuerySchema`, `type RecordsComparisonQuery` (`exerciseName`, `unit`, `from`, `to`, `baselineFrom`, `baselineTo`, all dates required)
  - `interface RecordsComparison { exercise; current; baseline; change }`, `PersonalRecordsService.compare(userId, query): Promise<RecordsComparison>`
  - `GET /users/:userId/personal-records/comparison`

- [ ] **Step 1: Append the failing comparison unit test**

Add `compareRecords` and `type PersonalRecords` to the import from `./personal-records.js` at the top of `src/personal-records/personal-records.spec.ts`, add `import { Decimal } from 'decimal.js';`, then append:

```ts
describe('compareRecords', () => {
  const record = (value: number) => ({
    value: new Decimal(value),
    weight: new Decimal(value),
    reps: 1,
    date: '2026-10-01',
    entryId: 'e',
  });
  const records = (maxWeight: number | null, maxVolume: number | null = null, bestE1rm: number | null = null): PersonalRecords => ({
    maxWeight: maxWeight === null ? null : record(maxWeight),
    maxVolume: maxVolume === null ? null : record(maxVolume),
    bestE1rm: bestE1rm === null ? null : record(bestE1rm),
  });

  it('reports absolute and percent change per metric', () => {
    expect(compareRecords(records(105, 1000, 120), records(100, 800, 125))).toEqual({
      maxWeight: { absolute: 5, percent: 5 },
      maxVolume: { absolute: 200, percent: 25 },
      bestE1rm: { absolute: -5, percent: -4 },
    });
  });

  it('rounds the percent change to two decimals', () => {
    expect(compareRecords(records(110), records(105)).maxWeight).toEqual({ absolute: 5, percent: 4.76 });
  });

  it('is null for a metric missing in either period', () => {
    expect(compareRecords(records(105), records(null))).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
  });

  it('has no percent change from a zero baseline (bodyweight sets)', () => {
    expect(compareRecords(records(10), records(0)).maxWeight).toEqual({ absolute: 10, percent: null });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/personal-records`
Expected: FAIL. `compareRecords` is not exported.

- [ ] **Step 3: Append the comparison to `src/personal-records/personal-records.ts`**

```ts
export interface MetricChange {
  /** current − baseline, in the requested unit. */
  absolute: number;
  /** Change relative to the baseline in percent; null when the baseline is zero. */
  percent: number | null;
}

export type RecordChanges = Record<PrMetric, MetricChange | null>;

export interface PeriodRecords {
  from: string;
  to: string;
  records: RecordsResponse;
}

export interface RecordsComparisonResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    current: PeriodRecords;
    baseline: PeriodRecords;
    change: RecordChanges;
  };
  /** Present only when neither period has data. */
  message?: string;
}

/** Per-metric change from the baseline period to the current one; null when either period lacks a record. */
export function compareRecords(current: PersonalRecords, baseline: PersonalRecords): RecordChanges {
  const change = (metric: PrMetric): MetricChange | null => {
    const now = current[metric];
    const before = baseline[metric];
    if (now === null || before === null) return null;
    const difference = now.value.minus(before.value);
    return {
      absolute: roundForDisplay(difference),
      percent: before.value.isZero() ? null : roundForDisplay(difference.div(before.value).times(100)),
    };
  };
  return { maxWeight: change('maxWeight'), maxVolume: change('maxVolume'), bestE1rm: change('bestE1rm') };
}
```

Run: `npm test -- src/personal-records`
Expected: PASS.

- [ ] **Step 4: Write the failing comparison e2e test**

`test/personal-records-comparison.e2e-spec.ts`:

```ts
import request from 'supertest';
import { entry, logOk, set } from './helpers/requests.js';
import { USER_A, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const OCTOBER_VS_SEPTEMBER = {
  from: '2026-10-01',
  to: '2026-10-31',
  baselineFrom: '2026-09-01',
  baselineTo: '2026-09-30',
};

describe('GET /users/:userId/personal-records/comparison', () => {
  let t: TestApp;

  const compare = (query: Record<string, string>) =>
    request(t.app.getHttpServer()).get(`/users/${USER_A}/personal-records/comparison`).query(query);
  const log = (entries: unknown[]) => logOk(t.app, USER_A, entries);

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('compares this month with last month', async () => {
    await log([entry('2026-09-05', 'Bench Press', [set(5, 100)])]); // baseline best volume 500, e1RM 116.67
    await log([entry('2026-09-20', 'Bench Press', [set(1, 105)])]); // baseline heaviest 105
    await log([entry('2026-10-03', 'Bench Press', [set(3, 110)])]); // current: 110, volume 330, e1RM 121
    const res = await compare({ exerciseName: 'Bench Press', ...OCTOBER_VS_SEPTEMBER });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      exerciseName: 'Bench Press',
      unit: 'kg',
      current: { from: '2026-10-01', to: '2026-10-31', records: { maxWeight: { value: 110, date: '2026-10-03' } } },
      baseline: { from: '2026-09-01', to: '2026-09-30', records: { maxWeight: { value: 105, date: '2026-09-20' } } },
      change: {
        maxWeight: { absolute: 5, percent: 4.76 },
        maxVolume: { absolute: -170, percent: -34 },
        bestE1rm: { absolute: 4.33, percent: 3.71 },
      },
    });
    expect(res.body).not.toHaveProperty('message');
  });

  it('reports null changes when one period has no data', async () => {
    await log([entry('2026-10-03', 'Bench Press', [set(3, 110)])]);
    const res = await compare({ exerciseName: 'Bench Press', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.baseline.records).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(res.body.data.change).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(res.body).not.toHaveProperty('message');
  });

  it('returns a message when neither period has data', async () => {
    const res = await compare({ exerciseName: 'Deadlift', ...OCTOBER_VS_SEPTEMBER });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No Deadlift entries found for this user in either date range.');
  });

  it('has no percent change from a zero-weight baseline', async () => {
    await log([entry('2026-09-10', 'Pull-Up', [set(10, 0)])]);
    await log([entry('2026-10-10', 'Pull-Up', [set(8, 10)])]);
    const res = await compare({ exerciseName: 'Pull-Up', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.change.maxWeight).toEqual({ absolute: 10, percent: null });
  });

  it('converts both periods to the requested unit', async () => {
    await log([entry('2026-09-05', 'Deadlift', [set(1, 100)])]);
    await log([entry('2026-10-05', 'Deadlift', [set(1, 225, 'lb')])]);
    const res = await compare({ exerciseName: 'Deadlift', unit: 'lb', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.current.records.maxWeight.value).toBe(225);
    expect(res.body.data.baseline.records.maxWeight.value).toBe(220.46);
    expect(res.body.data.change.maxWeight).toEqual({ absolute: 4.54, percent: 2.06 });
  });

  it('requires both periods and reports every reversed range', async () => {
    const missing = await compare({ exerciseName: 'Bench Press', from: '2026-10-01', to: '2026-10-31', baselineFrom: '2026-09-01' });
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([{ field: 'baselineTo', message: 'baselineTo is required' }]);

    const reversed = await compare({
      exerciseName: 'Bench Press',
      from: '2026-10-31',
      to: '2026-10-01',
      baselineFrom: '2026-09-30',
      baselineTo: '2026-09-01',
    });
    expect(reversed.status).toBe(400);
    expect(reversed.body.errors).toEqual([
      { field: 'from', message: 'from must be on or before to' },
      { field: 'baselineFrom', message: 'baselineFrom must be on or before baselineTo' },
    ]);
  });
});
```

The unit-conversion case: 225 lb against 100 kg = 220.462… lb gives a change of 4.5377… → 4.54, and 4.5377 / 220.4623 = 2.058 % → 2.06.

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:e2e -- test/personal-records-comparison.e2e-spec.ts`
Expected: FAIL. Nest routes `comparison` to nothing, so the requests 404.

- [ ] **Step 6: Implement the schema, service method and route**

Append to `src/personal-records/personal-records.schemas.ts`:

```ts
export const recordsComparisonQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema(),
    unit: weightUnitSchema.default('kg'),
    from: plainDateSchema('from'),
    to: plainDateSchema('to'),
    baselineFrom: plainDateSchema('baselineFrom'),
    baselineTo: plainDateSchema('baselineTo'),
  })
  .refine((query) => query.from <= query.to, { message: 'from must be on or before to', path: ['from'] })
  .refine((query) => query.baselineFrom <= query.baselineTo, {
    message: 'baselineFrom must be on or before baselineTo',
    path: ['baselineFrom'],
  });

export type RecordsComparisonQuery = z.output<typeof recordsComparisonQuerySchema>;
```

In `src/personal-records/personal-records.service.ts`, change the imports to:

```ts
import { type PersonalRecords, type RecordChanges, compareRecords, toPersonalRecords } from './personal-records.js';
import type { PersonalRecordsQuery, RecordsComparisonQuery } from './personal-records.schemas.js';
```

Add this interface below `ExerciseRecords`:

```ts
export interface RecordsComparison {
  exercise: ExerciseRef;
  current: PersonalRecords;
  baseline: PersonalRecords;
  change: RecordChanges;
}
```

Add this method to the class:

```ts
  /** Records in the current range against a baseline range, e.g. this month vs last month. */
  async compare(userId: string, query: RecordsComparisonQuery): Promise<RecordsComparison> {
    const exercise = await this.resolveExercise(query.exerciseName);
    const [currentRows, baselineRows] = await Promise.all([
      this.records.findRecordRows({ userId, exerciseId: exercise.id, from: query.from, to: query.to }),
      this.records.findRecordRows({
        userId,
        exerciseId: exercise.id,
        from: query.baselineFrom,
        to: query.baselineTo,
      }),
    ]);
    const current = toPersonalRecords(currentRows, query.unit);
    const baseline = toPersonalRecords(baselineRows, query.unit);
    return { exercise, current, baseline, change: compareRecords(current, baseline) };
  }
```

In `src/personal-records/personal-records.controller.ts`, change the imports to:

```ts
import {
  type PersonalRecordsResponse,
  type RecordsComparisonResponse,
  hasAnyRecord,
  presentRecords,
} from './personal-records.js';
import {
  type PersonalRecordsQuery,
  type RecordsComparisonQuery,
  personalRecordsQuerySchema,
  recordsComparisonQuerySchema,
} from './personal-records.schemas.js';
```

Add this method to the controller:

```ts
  /** Records in one date range against a baseline range, e.g. this month vs last month (ADR 0002). */
  @Get('comparison')
  async compare(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(recordsComparisonQuerySchema)) query: RecordsComparisonQuery,
  ): Promise<RecordsComparisonResponse> {
    const result = await this.service.compare(userId, query);
    const noData = !hasAnyRecord(result.current) && !hasAnyRecord(result.baseline);
    return {
      data: {
        exerciseName: result.exercise.name,
        unit: query.unit,
        current: { from: query.from, to: query.to, records: presentRecords(result.current) },
        baseline: { from: query.baselineFrom, to: query.baselineTo, records: presentRecords(result.baseline) },
        change: result.change,
      },
      ...(noData ? { message: `No ${result.exercise.name} entries found for this user in either date range.` } : {}),
    };
  }
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/personal-records test/personal-records-comparison.e2e-spec.ts
git commit -m "feat: compare personal records between two date ranges" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Performance at 50,000+ entries per user

**Files:**
- Create: `scripts/seed-large-dataset.sql`
- Test: `test/large-dataset.e2e-spec.ts`

**Interfaces:**
- Consumes: `buildHistoryQuery` (Task 9), `buildPersonalRecordsQuery` (Task 10), `ExercisesRepository.findIds` (Task 6), test helpers (Task 5).
- Produces: a seed script driven by the session settings `seed.user_id` and `seed.entries`, reused by the README's manual performance check.

- [ ] **Step 1: Write the seed script**

`scripts/seed-large-dataset.sql`:

```sql
-- Seeds a large workout history for one user: seed.entries entries (14 per day, walking back
-- from 2026-10-15 and cycling through the catalog), each with 3 sets of 5 reps.
-- Set seed.user_id (uuid) and seed.entries (int) in the session first; see README "Performance".
WITH params AS (
  SELECT current_setting('seed.user_id')::uuid AS user_id,
         current_setting('seed.entries')::int AS entries,
         (SELECT array_agg(id ORDER BY name) FROM exercises) AS exercise_ids
),
inserted AS (
  INSERT INTO workout_entries
    (id, user_id, exercise_id, performed_on, best_weight_kg, best_volume_kg, best_e1rm_kg, created_at)
  SELECT gen_random_uuid(),
         p.user_id,
         p.exercise_ids[1 + g % cardinality(p.exercise_ids)],
         DATE '2026-10-15' - (g / 14),
         w.kg,
         w.kg * 5,
         round(w.kg * (1 + 5 / 30.0), 3),
         TIMESTAMPTZ '2026-10-15 12:00:00+00' - g * INTERVAL '1 minute'
  FROM params p
  CROSS JOIN generate_series(1, p.entries) AS g
  CROSS JOIN LATERAL (SELECT (40 + g % 80)::numeric AS kg) AS w
  RETURNING id, best_weight_kg
)
INSERT INTO workout_sets (entry_id, set_index, reps, weight, unit, weight_kg)
SELECT i.id, s, 5, i.best_weight_kg, 'kg', i.best_weight_kg
FROM inserted i
CROSS JOIN generate_series(0, 2) AS s;
```

- [ ] **Step 2: Write the performance test**

`test/large-dataset.e2e-spec.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import request from 'supertest';
import { ExercisesRepository } from '../src/exercises/exercises.repository.js';
import { buildPersonalRecordsQuery } from '../src/personal-records/personal-records.repository.js';
import { buildHistoryQuery } from '../src/workouts/workout-entries.repository.js';
import { entriesOf } from './helpers/requests.js';
import { createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const HEAVY_USER = '7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const OTHER_USER = '8e4a2b3c-5d6e-4f7a-9b0c-1d2e3f4a5b6c';
const SEED_SQL = join(import.meta.dirname, '..', 'scripts', 'seed-large-dataset.sql');
/** Server-side execution budget per query. Index-backed queries take about a millisecond here. */
const QUERY_BUDGET_MS = 50;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

interface ExplainOutput {
  Plan: PlanNode;
  'Execution Time': number;
}

async function seed(pool: Pool, userId: string, entries: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('seed.user_id', $1, false), set_config('seed.entries', $2, false)", [
      userId,
      String(entries),
    ]);
    await client.query(await readFile(SEED_SQL, 'utf8'));
  } finally {
    client.release();
  }
}

async function explain(pool: Pool, query: { text: string; values: unknown[] }): Promise<ExplainOutput> {
  const { rows } = await pool.query<{ 'QUERY PLAN': ExplainOutput[] }>(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`,
    query.values,
  );
  return rows[0]['QUERY PLAN'][0];
}

/** Tables read with a (parallel) sequential scan anywhere in the plan. */
function seqScannedTables(node: PlanNode): string[] {
  const own = node['Node Type'].includes('Seq Scan') && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap((child) => seqScannedTables(child))];
}

describe('50,000 entries for one user', () => {
  let t: TestApp;
  let deadliftId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetWorkouts(t.pool);
    await seed(t.pool, HEAVY_USER, 50_000);
    await seed(t.pool, OTHER_USER, 10_000);
    await t.pool.query('ANALYZE workout_entries; ANALYZE workout_sets');
    const { rows } = await t.pool.query<{ id: string }>("SELECT id FROM exercises WHERE name = 'Deadlift'");
    deadliftId = rows[0].id;
  });

  afterAll(async () => {
    await resetWorkouts(t.pool);
    await t.app.close();
  });

  it('has the seeded volume', async () => {
    const { rows } = await t.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workout_entries WHERE user_id = $1',
      [HEAVY_USER],
    );
    expect(rows[0].count).toBe(50_000);
  });

  it('reads a deep history page through the index', async () => {
    const after = { performedOn: '2019-01-01', createdAt: '2019-01-01T00:00:00Z', id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' };
    const result = await explain(t.pool, buildHistoryQuery({ userId: HEAVY_USER, after, limit: 21 }));
    expect(seqScannedTables(result.Plan)).not.toContain('workout_entries');
    expect(seqScannedTables(result.Plan)).not.toContain('workout_sets');
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
  });

  it('reads filtered history through the index', async () => {
    const squats = await t.app.get(ExercisesRepository).findIds({ nameContains: 'squat' });
    const result = await explain(
      t.pool,
      buildHistoryQuery({ userId: HEAVY_USER, exerciseIds: squats, from: '2025-01-01', to: '2025-12-31', limit: 21 }),
    );
    expect(seqScannedTables(result.Plan)).not.toContain('workout_entries');
    expect(seqScannedTables(result.Plan)).not.toContain('workout_sets');
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
  });

  it.each([
    { name: 'all-time', range: {} },
    { name: 'ten-year', range: { from: '2016-01-01', to: '2026-12-31' } },
    { name: 'one-month', range: { from: '2026-09-01', to: '2026-09-30' } },
  ])('finds $name records through the indexes', async ({ range }) => {
    const result = await explain(
      t.pool,
      buildPersonalRecordsQuery({ userId: HEAVY_USER, exerciseId: deadliftId, ...range }),
    );
    expect(seqScannedTables(result.Plan)).toEqual([]);
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
  });

  it('pages through history over HTTP without repeats', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await request(t.app.getHttpServer())
        .get(`/users/${HEAVY_USER}/workout-entries`)
        .query(cursor === null ? { limit: 100 } : { limit: 100, cursor });
      expect(res.status).toBe(200);
      expect(entriesOf(res)).toHaveLength(100);
      entriesOf(res).forEach((e) => seen.add(e.id));
      cursor = res.body.page.nextCursor;
    }
    expect(seen.size).toBe(500);
  });

  it('returns records and a comparison over HTTP', async () => {
    const server = t.app.getHttpServer();
    const records = await request(server).get(`/users/${HEAVY_USER}/personal-records`).query({ exerciseName: 'Deadlift' });
    expect(records.status).toBe(200);
    expect(records.body.data.records.maxWeight).not.toBeNull();
    const comparison = await request(server).get(`/users/${HEAVY_USER}/personal-records/comparison`).query({
      exerciseName: 'Deadlift',
      from: '2026-09-01',
      to: '2026-09-30',
      baselineFrom: '2025-09-01',
      baselineTo: '2025-09-30',
    });
    expect(comparison.status).toBe(200);
    expect(comparison.body.data.change.maxWeight).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm run test:e2e -- test/large-dataset.e2e-spec.ts`
Expected: PASS. Seeding takes a few seconds. If an `Execution Time` assertion fails, do not raise the budget. Print the plan (`console.log(JSON.stringify(result.Plan, null, 2))`) and use superpowers:systematic-debugging, because a slow plan here means an index is not being used.

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run test:e2e && npm run typecheck && npm run lint`
Expected: all pass. The other e2e files truncate in `beforeEach`, and this file cleans up in `afterAll`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-large-dataset.sql test/large-dataset.e2e-spec.ts
git commit -m "test: prove index-backed history and PR queries at 50k entries per user" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docker and Compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`

**Interfaces:**
- Consumes: `npm run build`, `dist/main.js` (runs migrations, then listens on `PORT`), `migrations/`, `GET /health`.
- Produces: `docker compose up --build` gives the API on `localhost:3000` and Postgres on `localhost:5433` (user, password and database are all `workout`). If those host ports are busy, override them with `API_PORT` and `DB_PORT`. All smoke commands below assume the defaults. If you override, use your ports instead.

- [ ] **Step 1: Write the Docker files**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
# Migrations run at startup under an advisory lock (src/main.ts).
CMD ["node", "dist/main.js"]
```

`.dockerignore`:

```
.git
.claude
node_modules
dist
coverage
test
docs
scripts
*.md
*.pdf
.env
```

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: workout
      POSTGRES_PASSWORD: workout
      POSTGRES_DB: workout
    ports:
      - '${DB_PORT:-5433}:5432'
    volumes:
      # Postgres 18 images keep data under /var/lib/postgresql/18/docker; mount the parent.
      - db-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U workout -d workout']
      interval: 2s
      timeout: 3s
      retries: 30

  api:
    build: .
    environment:
      DATABASE_URL: postgres://workout:workout@db:5432/workout
      PORT: '3000'
      LOG_LEVEL: info
      DB_POOL_MAX: '10'
    ports:
      - '${API_PORT:-3000}:3000'
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/health || exit 1']
      interval: 5s
      timeout: 3s
      retries: 12

volumes:
  db-data:
```

`.env.example`:

```
# Copy the variables you need into your shell; the app reads the process environment.
# Local development against `docker compose up -d db`:
DATABASE_URL=postgres://workout:workout@localhost:5433/workout
PORT=3000
LOG_LEVEL=info
DB_POOL_MAX=10
```

- [ ] **Step 2: Build and start the stack, waiting for health checks**

Run: `docker compose up --build --wait`
Expected: exits 0 once `db` and `api` are healthy.

- [ ] **Step 3: Smoke-test the running API**

Run:

```bash
curl -s localhost:3000/health
curl -s localhost:3000/exercises | jq '.data | length'
curl -s -X POST localhost:3000/users/0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e/workout-entries \
  -H 'Content-Type: application/json' \
  -d '{"entries":[{"date":"2026-10-14","exerciseName":"Deadlift","sets":[{"reps":5,"weight":140,"unit":"kg"}]}]}' | jq '.data[0].exerciseName'
curl -s 'localhost:3000/users/0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e/workout-entries?unit=lb' | jq '.data[0].sets'
docker compose logs api | grep Applied
```

Expected: `{"status":"ok"}`, then `16`, then `"Deadlift"`, then `[{"reps":5,"weight":308.65,"unit":"lb"}]`, then a JSON log line containing `"msg":"Applied 0001_create_schema.sql, 0002_seed_exercise_catalog.sql"`.

- [ ] **Step 4: Check that a restart keeps data and skips migrations, then tear down**

Run: `docker compose restart api && docker compose up --wait && docker compose logs api | grep -c 'Schema is up to date' && docker compose down -v`
Expected: the `grep` count is `1` and the stack is removed.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml .env.example
git commit -m "chore: add Docker image and Compose stack with health checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: README, demo script and CLAUDE.md

**Files:**
- Create: `README.md`, `scripts/demo.sh`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; the README must describe the behaviour exactly as implemented.
- Produces: the deliverable README (architecture, setup, API docs, schema, trade-offs, scale); `scripts/demo.sh` for the video.

- [ ] **Step 1: Write `scripts/demo.sh`**

```bash
#!/usr/bin/env bash
# Walks through every endpoint, including error handling. Run after `docker compose up --wait`.
# Requires curl, jq and uuidgen. Usage: scripts/demo.sh [base-url]
set -euo pipefail

BASE_URL=${1:-http://localhost:3000}
CLIENT=$(uuidgen | tr '[:upper:]' '[:lower:]')
USER="/users/$CLIENT"

section() { printf '\n\033[1;34m### %s\033[0m\n' "$1"; }

# call METHOD PATH [curl args...]: prints the request, the HTTP status and the JSON body.
call() {
  local method=$1 path=$2 response
  shift 2
  printf '\n\033[1m%s %s\033[0m\n' "$method" "$path"
  response=$(curl -sS -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' -w '\n%{http_code}' "$@")
  printf 'HTTP %s\n' "${response##*$'\n'}"
  printf '%s\n' "${response%$'\n'*}" | jq .
}

section 'Health and the exercise catalog'
call GET /health
call GET /exercises

section 'Log a bulk session: kg and lb, a plain date and a datetime with offset'
SESSION='{"entries":[
  {"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"},{"reps":3,"weight":105,"unit":"kg"}]},
  {"date":"2026-09-08T18:30:00+07:00","exerciseName":"back squat","sets":[{"reps":5,"weight":225,"unit":"lb"}]}
]}'
call POST "$USER/workout-entries" -H 'Idempotency-Key: demo-session-1' -d "$SESSION"

section 'Retry with the same Idempotency-Key: nothing new is stored'
curl -sS -o /dev/null -D - -X POST "$BASE_URL$USER/workout-entries" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-session-1' -d "$SESSION" | grep -i -E '^(HTTP|idempotent-replayed)'

section 'More sessions'
call POST "$USER/workout-entries" -d '{"entries":[{"date":"2026-09-22","exerciseName":"Bench Press","sets":[{"reps":1,"weight":110,"unit":"kg"}]}]}'
call POST "$USER/workout-entries" -d '{"entries":[
  {"date":"2026-10-06","exerciseName":"Bench Press","sets":[{"reps":3,"weight":112.5,"unit":"kg"},{"reps":8,"weight":95,"unit":"kg"}]},
  {"date":"2026-10-06","exerciseName":"Pull-Up","sets":[{"reps":10,"weight":0,"unit":"kg"}]}
]}'

section 'History: newest first, converted, filtered, paginated'
call GET "$USER/workout-entries"
call GET "$USER/workout-entries?unit=lb"
call GET "$USER/workout-entries?exerciseName=press&muscleGroup=chest"
call GET "$USER/workout-entries?from=2026-10-01&to=2026-10-31"
call GET "$USER/workout-entries?from=2025-01-01&to=2025-01-31"
NEXT=$(curl -sS "$BASE_URL$USER/workout-entries?limit=2" | jq -r .page.nextCursor)
call GET "$USER/workout-entries?limit=2&cursor=$NEXT"

section 'Personal records'
call GET "$USER/personal-records?exerciseName=bench%20press"
call GET "$USER/personal-records?exerciseName=Bench%20Press&unit=lb"
call GET "$USER/personal-records/comparison?exerciseName=Bench%20Press&from=2026-10-01&to=2026-10-31&baselineFrom=2026-09-01&baselineTo=2026-09-30"

section 'Error handling'
call POST "$USER/workout-entries" -d '{"entries":[{"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"stone"}]}]}'
call POST "$USER/workout-entries" -d '{"entries":[{"date":null,"exerciseName":"Bench Press","sets":[]}]}'
call POST "$USER/workout-entries" -d '{"entries":[{"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":-1,"weight":-5,"unit":"kg"}]}]}'
call POST "$USER/workout-entries" -d '{"entries":[{"date":"2026-09-08T06:00:00","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
call POST "$USER/workout-entries" -d '{"entries":[{"date":"2030-01-01","exerciseName":"Benchpress","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
call POST "$USER/workout-entries" -d '{"entries": ['
call POST /users/not-a-uuid/workout-entries -d '{"entries":[]}'
call GET "$USER/workout-entries?exercise=bench"
call GET "$USER/workout-entries?muscleGroup=wings"
call GET "$USER/workout-entries?cursor=garbage"
call GET "$USER/personal-records?exerciseName=Bench%20Press&from=2026-10-31&to=2026-10-01"
```

Run: `chmod +x scripts/demo.sh && docker compose up --build --wait && scripts/demo.sh > /dev/null && echo DEMO_OK && docker compose down -v`
Expected: `DEMO_OK`. The script exits non-zero on any curl or jq failure. If port 3000 is taken, prefix `docker compose up` with `API_PORT=3300` and pass `http://localhost:3300` to the script.

- [ ] **Step 2: Write `README.md`**

````markdown
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
USER=0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e
curl -s -X POST localhost:3000/users/$USER/workout-entries -H 'Content-Type: application/json' \
  -d '{"entries":[{"date":"2026-10-14","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
curl -s "localhost:3000/users/$USER/workout-entries?unit=lb"
curl -s "localhost:3000/users/$USER/personal-records?exerciseName=Bench%20Press"
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

- `entries`: 1–50 items. `sets`: 1–50 per entry. `reps`: an integer, 1–1000. `weight`: 0–5000 (0 for bodyweight). `unit`: `kg` or `lb`, case-insensitive.
- `exerciseName` must name a catalog exercise (`GET /exercises`). Matching trims whitespace and ignores case, and responses use the canonical name ([ADR 0004](docs/adr/0004-predefined-exercise-catalog.md)).
- `date` is `YYYY-MM-DD` or an ISO 8601 datetime with an offset. The day is read in the offset you send, so send your local offset rather than `toISOString()` output. A datetime without an offset is rejected, and so is any day later than tomorrow in UTC ([ADR 0002](docs/adr/0002-workout-date-and-timezone.md)).
- Unknown fields are rejected. The whole request is validated first and every problem is reported at once. Nothing is stored unless every entry is valid.
- Weights are stored with 3 decimals. Each set keeps its logged `weight` and `unit` and also stores `weight_kg`.
- **Idempotency** ([ADR 0003](docs/adr/0003-concurrent-writes-and-idempotency.md)): with an `Idempotency-Key` header (1–200 visible ASCII characters), a retry stores nothing new and returns the original entries with `Idempotent-Replayed: true`. Parallel retries are safe. Keys are scoped to the user. Use a new key for every new request: reusing a key with a different body returns the original entries. Without a key, every request is stored, including identical ones.

### History: `GET /users/{userId}/workout-entries`

| Query | Meaning |
| --- | --- |
| `exerciseName` | Case-insensitive partial match (`squat` matches Back Squat and Front Squat); `%` and `_` are literal |
| `muscleGroup` | Exact muscle group, case-insensitive (`chest`, `back`, …); an unknown group returns `400` listing the valid ones |
| `from`, `to` | Inclusive `YYYY-MM-DD` bounds on the workout day |
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

An empty page returns `200` with `"data": []` and `"message": "No workout entries match the given filters."`.

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
- Metrics without data are `null`, and the response then carries a `message`.

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
| 400 | `BAD_REQUEST` | Malformed JSON |
| 404 | `NOT_FOUND` | Unknown route |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 1 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported body charset |
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

- deep history pages, filtered history and every PR query run without sequential scans on `workout_entries` or `workout_sets`, in under 50 ms server time each (EXPLAIN ANALYZE);
- cursor paging over HTTP returns 100 distinct entries per page.

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
- **Idempotency** does not detect a key reused with a different body, and keys never expire (ADR 0003).
- **Epley for one rep** follows the brief literally (`weight × 1.033`); many apps special-case it to the lifted weight.
- **Entries from one bulk request** share `created_at`, so their order within a day is by id: stable, but not request order.
- **No time of day** is stored (ADR 0002). It can be added later as a nullable `performed_at` without touching `performed_on`.

## What I would change for 10,000 concurrent coaches

- **Stateless replicas behind a load balancer**, with **PgBouncer** in transaction mode. Ten replicas × `DB_POOL_MAX` would exceed Postgres' connection limit otherwise.
- **Read replicas** for history and PR reads. Writes stay on the primary, and a read-your-writes path is needed right after logging.
- **Run migrations as a deploy step**, not at startup.
- **Hash-partition** `workout_entries` and `workout_sets` by `user_id` once they reach hundreds of millions of rows. Every query already filters by `user_id`, so partition pruning comes for free.
- **Cache `GET /exercises`** with `Cache-Control` and an ETag (it only changes with a deploy), and keep the catalog in memory.
- **Authentication and authorization**: take the coach identity from a token and check coach → client access, instead of trusting `userId` in the path. Add per-coach rate limiting.
- **An idempotency key table** with a payload hash (409 on mismatch) and an expiry job (ADR 0003 "Revisit If").
- **Observability**: RED metrics per route, OpenTelemetry tracing through to `pg`, `pg_stat_statements`, and alerts on p99 latency and pool saturation. Logs are already structured JSON with request ids.
- **An OpenAPI document** generated from the Zod schemas (`z.toJSONSchema`) for client SDKs.
````

- [ ] **Step 3: Update `CLAUDE.md`**

Insert this block immediately before the line `## Design decisions (ADRs in \`docs/adr/\`)`:

```markdown
## Commands

- `docker compose up --build --wait` — API on :3000 and Postgres 18 on :5433; migrations run on startup.
- `npm run start:dev` — watch mode; needs `DATABASE_URL`, e.g. `docker compose up -d db` then `DATABASE_URL=postgres://workout:workout@localhost:5433/workout npm run start:dev`.
- `npm test` — unit tests (Vitest, `src/**/*.spec.ts`, no database).
- `npm run test:e2e` — e2e tests (`test/**/*.e2e-spec.ts`) against a Testcontainers Postgres 18; Docker must be running.
- `npm run lint` (oxlint, type-aware), `npm run typecheck`, `npm run build`.
- `scripts/demo.sh` — curl walkthrough of every endpoint and error case.

## Code conventions

- ESM (`"type": "module"`): relative imports end in `.js`; import Decimal as `import { Decimal } from 'decimal.js'`.
- Interfaces and type aliases used in decorated signatures (injected constructor params, controller params) must be `import type` or inline `type` (isolatedModules + emitDecoratorMetadata).
- Layers: controller (Zod pipes) → service (rules) → repository (parameterized SQL only). Pure math and parsing live in `src/domain` and use `decimal.js`, never floats.
- Validation failures throw `RequestValidationError` with field paths; the global filter renders every error as `{ statusCode, code, message, errors?, requestId? }`.
- The implementation plan is `docs/superpowers/plans/2026-10-15-workout-logging-api.md`.
```

- [ ] **Step 4: Check the docs against the code**

Run: `npm test && npm run test:e2e && npm run lint && npm run typecheck`
Expected: all pass. Then read the README API section next to the e2e tests and fix any mismatch in the README, not in the tests.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/demo.sh CLAUDE.md
git commit -m "docs: add README, demo script and project commands" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Align the ADR 0001 Summary with the implemented schema (separate docs PR)

The project convention is one ADR change per PR, so this task runs on its own branch from `main` after the feature branch is merged.

**Files:**
- Modify: `docs/adr/0001-database-selection.md`

**Interfaces:**
- Consumes: `migrations/0001_create_schema.sql` (Task 5) as the source of truth.
- Produces: an ADR 0001 Summary that matches the schema.

- [ ] **Step 1: Branch from the updated `main`**

```bash
git switch main && git pull --ff-only && git switch -c docs/adr-0001-implementation-alignment
```

- [ ] **Step 2: Update the `workout_sets` entity in the Summary's Mermaid diagram**

Replace:

```
    workout_sets {
        uuid id PK
        uuid entry_id FK "ON DELETE CASCADE"
        smallint set_index "order within entry"
```

with:

```
    workout_sets {
        uuid entry_id PK, FK "ON DELETE CASCADE"
        smallint set_index PK "order within entry"
```

- [ ] **Step 3: Replace the Summary's "Key indexes" list**

Replace:

```
Key indexes:
- `workout_entries (user_id, performed_on DESC, id DESC)`: history and cursor pagination
- `workout_entries (user_id, exercise_id, performed_on)`: PR range comparisons
- `workout_entries (user_id, exercise_id, best_weight_kg DESC)`, and the same for `best_volume_kg` and `best_e1rm_kg`: all-time PR lookups
- `workout_sets (entry_id, set_index)`: loading an entry's sets
- `exercises USING gin (name gin_trgm_ops)`: partial name match
```

with:

```
Key indexes:
- `workout_entries (user_id, performed_on DESC, created_at DESC, id DESC)`: history and cursor pagination, in the order ADR 0002 defines
- `workout_entries (user_id, exercise_id, performed_on)`: PR range comparisons and history filtered by exercise
- `workout_entries (user_id, exercise_id, best_weight_kg DESC, performed_on)`, and the same for `best_volume_kg` and `best_e1rm_kg`: PR lookups; the trailing `performed_on` dates a tied record by the first time it was reached
- `workout_sets PRIMARY KEY (entry_id, set_index)`: loading an entry's sets; sets are never addressed on their own, so there is no surrogate id
- `exercises USING gin ((name::text) gin_trgm_ops)`: partial name match; `citext` has no trigram operator class, so the index is on the text cast
```

- [ ] **Step 4: Add implementation notes under "Key trade-offs accepted"**

Append these bullets to the end of the Summary's "Key trade-offs accepted" list:

```
- Weights and summaries are `NUMERIC(10,3)` (volume `NUMERIC(14,3)`, e1RM `NUMERIC(12,3)`): gram precision, computed with exact decimals in the API.
- Entry ids are generated by the API, so a bulk request inserts all entries and all sets with one multi-row statement each.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/adr/0001-database-selection.md
git commit -m "docs: align ADR 0001 summary indexes and keys with the implementation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin docs/adr-0001-implementation-alignment
gh pr create --base main --title "docs: ADR 0001 — align summary with implemented schema" --body "$(cat <<'EOF'
## Summary
- History index includes `created_at` (ADR 0002 ordering); PR indexes end with `performed_on` (earliest date wins ties).
- `workout_sets` uses `PRIMARY KEY (entry_id, set_index)` instead of a surrogate id.
- Trigram index is on `(name::text)` because `citext` has no trigram operator class.
- Notes NUMERIC precision and API-generated entry ids.

Matches `migrations/0001_create_schema.sql`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

