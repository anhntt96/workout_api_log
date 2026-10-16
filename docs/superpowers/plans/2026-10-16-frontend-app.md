# Workout Log Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A polished React + Tailwind CSS app in `frontend/` that demos the Workout Logging API to the Everfit reviewers: choose a client by UUID, browse and filter their history, see their personal records and compare periods, log workouts, and load sample data.

**Architecture:** A separate Vite + React + TypeScript package in `frontend/`. The browser calls only same-origin `/api/*`; the Vite dev server (in development) and an nginx container (in Docker) proxy those calls to the API, so the backend does not change. Server state lives in TanStack Query (cursor paging through `useInfiniteQuery`). The chosen client and the kg/lb display unit live in a small context backed by `localStorage`. Filters and the selected exercise live in the URL.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Tailwind CSS 4, TanStack Query 5, React Router 7, lucide-react icons, Inter Variable font. Tests: Vitest 4, jsdom, Testing Library, MSW 2. Tooling: oxlint, Prettier. Docker: nginx 1.30.

**Spec:** There is no separate spec file. The decisions from brainstorming are recorded in the **Design** section below, and the tasks argue from it.

**Verified before writing:** All the code in this plan was built and run in a scratch copy. 101 tests, the type-check, lint, Prettier and the production build pass, and the plan was replayed task by task: each "failing test" step fails, and each task ends green. The Docker image builds from a lockfile made on macOS. The app also ran against this repo's real API through both the Vite proxy and nginx, with screenshots checked at 1440 px and 390 px wide.

## Design

### Purpose and success

- **Audience:** the reviewers of the Everfit backend assignment, in the video walkthrough and when they run `docker compose up`. The app shows the API's features and edge cases, so polish and a smooth demo matter most.
- **Success:** one command starts the database, API and UI. A reviewer enters or generates a client UUID, loads sample data, and sees history, records and comparisons that come from the real API. The screens look good in a recording at laptop width and still work on a phone.

### Scope

- **Welcome:** enter or generate a client UUID. It is checked in the browser with the API's own rule (8-4-4-4-12 hex), stored in `localStorage`, and reused on the next visit. "Switch client" in the header returns to this screen with the current ID filled in.
- **History:** every entry for the client, newest first, grouped by day. Filters: partial exercise name (debounced 300 ms), muscle group (the options come from `GET /exercises`) and an inclusive date range. The filters live in the URL. "Load more" follows `page.nextCursor`.
- **Personal records:** an exercise picker (`?exercise=` in the URL) and three cards: heaviest single set, highest volume set and best estimated 1RM. Each card shows the value, the set that achieved it and the date.
- **Extras chosen during brainstorming:** a Log workout form (bulk POST), a period comparison (this week, month or year against the previous one), and a Load sample data button.
- **Display unit:** a kg/lb switch in the header converts every weight. History and records request `unit`, and new sets default to it.
- **Out of scope:** editing or deleting entries (the API has neither), authentication, a light theme, translations (en-US formatting only), offline support, browser end-to-end tests.

### Visual design

- **Mood:** dark and athletic. The page is `zinc-950` with a faint lime glow at the top. Cards are `zinc-900/60` with `white/10` borders, `rounded-2xl` corners and a soft black shadow. Text uses `zinc-100`, `zinc-400` and `zinc-500`. `color-scheme: dark` makes native date pickers and selects match.
- **Color:** one accent, `lime-400`, for primary buttons, the active nav item, focus rings and selected segments, with `zinc-950` text on it. Each record metric has its own hue: amber for heaviest, sky for volume, violet for e1RM. Changes are emerald (up) or rose (down) and always carry a trend icon and a sign.
- **Type:** Inter Variable, self-hosted through `@fontsource-variable/inter` so the Docker build needs no font CDN. Every number uses `tabular-nums`; record values are `text-5xl font-bold`; UUIDs are `font-mono`.
- **Layout:** a 16 rem sidebar (brand and nav) from the `lg` breakpoint up. A sticky, blurred top bar on every size holds the kg/lb control and the client chip. Phones get a bottom tab bar. Content is at most `max-w-5xl` wide.
- **Primitives** in `src/components/ui`: `Button` (primary, secondary, ghost, danger in sm, md, lg, plus `buttonClass` for links), `Card`, `Input` and `Select` (label, hint, error, `aria-invalid`, `aria-describedby`), `SegmentedControl` (a radio group), `Alert` (error, success, info), `EmptyState`, `Skeleton`.
- **Welcome:** two columns on desktop. On the left, the headline "Every rep logged. / Every record earned." (the second line in a lime-to-emerald gradient) and three feature bullets. On the right, a "Choose a client" card with the ID field, Continue, and "Generate a new client ID".
- **History:** a header with Log workout, and a filter card (search with an icon, muscle group, From, To, Clear). Day headings ("Today", "Yesterday", "Wed, Oct 14") stick under the top bar. Each entry is a card with the exercise, muscle-group chips, Sets / Volume / Top set stats, and set pills such as `5 × 100 kg` (`10 × BW` for bodyweight). Skeletons show while loading. There are two empty states: "No workouts yet" (Log workout and Load sample data) and "No matching workouts" (the API's message and Clear filters).
- **Records:** three tinted cards in a row. An info banner shows the API's "no entries" message with actions. A "Compare periods" card has a Week / Month / Year control and a table with one row per record: last period, this period (value and date) and a change badge such as `+5 kg · +4.76%`.
- **Log workout:** a session date card; one card per exercise (number badge, exercise select, remove button) with a sets table (reps, weight, unit, remove) and Add set, which repeats the previous set; a dashed Add exercise button; and a sticky bar with "2 exercises · 3 sets" and Save workout.

### Behavior and data flow

- **API access:** `src/api/client.ts` → `endpoints.ts` → `queries.ts` (hooks). Every non-2xx response becomes an `ApiError` carrying the API's `code`, `errors[]` (field paths) and `requestId`. A network failure becomes `NETWORK_ERROR`, and an error response that is not JSON (an nginx 502, for example) still gets a readable message. Queries do not retry a 4xx and retry other failures twice. A successful write invalidates history and records.
- **Validation:** the log form sends exactly what was typed (blank numbers as `null`, an unchosen exercise as `''`), so the API's validation is the only rule set. Its `errors[].field` paths (`entries[0].sets[1].weight`) are shown next to the matching inputs and listed in an alert with the request id. They clear on the next edit, because positions can shift.
- **Idempotency (ADR 0003):** each form generates one `Idempotency-Key` with `crypto.randomUUID()` and reuses it for retries and double clicks. Sample data always uses `sample-data-<userId>`, so a second click replays instead of duplicating. When the API answers `Idempotent-Replayed: true`, the banner says "This workout was already saved."
- **Dates (ADR 0002):** the browser computes "today" and every period boundary as local `YYYY-MM-DD` days. Weeks start on Monday. A comparison is "this period so far" against "the whole previous period".
- **After saving:** the app goes to History with a one-time success banner passed in router state. The state is then cleared, so a reload does not show the banner again.

### Testing

- Pure logic (dates, formatting, UUIDs, filters, grouping, the form reducer, sample data) has unit tests.
- Screens are tested through the real routes with Testing Library, `user-event`, and MSW handlers shaped like the API. The default handlers return the catalog and an empty account, and any request no handler matches fails the test.
- Vitest runs in `Asia/Ho_Chi_Minh` (UTC+7) with `Date` frozen at 2026-10-16 00:30 local time, when the UTC day is still the 15th, so dates are deterministic and a screen that uses the UTC day fails.
- Docker and the live API are checked by hand in the last task.

### Run and deploy

- **Development:** `npm run dev` in `frontend/` serves port 5173 and proxies `/api` to `API_URL` (default `http://localhost:3000`).
- **Docker:** a `web` service in `docker-compose.yml` builds the app and serves it with nginx on `WEB_PORT` (default 8080). nginx proxies `/api/` to `http://api:3000/` and serves `index.html` for client-side routes.

## Global Constraints

- Node.js 24 or later, the same as the backend's `engines`. The plan was verified on Node 26.
- Dependencies use caret ranges and the lockfile is committed: `react` and `react-dom` ^19.3.1, `react-router` ^7.18.4, `@tanstack/react-query` ^5.104.3, `lucide-react` ^1.57.0, `clsx` ^2.1.1, `@fontsource-variable/inter` ^5.3.0. Dev: `vite` ^8.3.4, `@vitejs/plugin-react` ^6.1.2, `tailwindcss` and `@tailwindcss/vite` ^4.3.3, `typescript` ^6.0.3, `vitest` ^4.1.11, `jsdom` ^30.1.3, `@testing-library/react` ^16.3.3, `@testing-library/dom` ^10.4.2, `@testing-library/user-event` ^14.6.8, `@testing-library/jest-dom` ^7.0.1, `msw` ^2.15.0, `oxlint` ^1.88.0, `prettier` ^3.9.10, `prettier-plugin-tailwindcss` ^0.8.1, `@types/react` and `@types/react-dom` ^19.3.0, `@types/node` ^24.19.2.
- Stay on React Router 7 and MSW 2. React Router 8 and MSW 3 are only weeks old, and this plan's code is written against the v7 and v2 APIs. Do not use `@testing-library/jest-dom` 6.10.0, which is deprecated. Vite, Vitest and TypeScript match the backend's versions.
- No backend code changes. Outside `frontend/`, only `tsconfig.json`, `.dockerignore`, `docker-compose.yml`, `README.md` and `CLAUDE.md` change.
- The browser calls only same-origin `/api/*`. Never hard-code `http://localhost:3000` in `frontend/src`.
- Relative imports in `frontend/src` have no file extension (bundler resolution), unlike the backend's `.js` rule. Type-only imports use `import type` or inline `type` (`verbatimModuleSyntax`).
- Calendar days are local `YYYY-MM-DD` strings from `src/lib/dates.ts`. Never derive a day from `toISOString()`, which gives the UTC day.
- Display text uses the `en-US` formatters in `src/lib`.
- Tailwind classes are written out in full, and variant maps hold complete class strings. Tailwind only generates the classes it finds in the source.
- Accessibility: every control has a label (visible or `sr-only`), decorative icons have `aria-hidden="true"`, keyboard focus shows a lime outline, and color is never the only signal.
- Prettier settings match the backend (`singleQuote`, `trailingComma: all`, `printWidth: 110`) plus Tailwind class sorting. Every task ends with `npm run format:check` passing.
- Commit messages follow the repo's `type: summary` style (`feat:`, `test:`, `docs:`, `chore:`) and end with the Co-Authored-By trailer configured for the executing session.
- Run `npm` commands in `frontend/` unless a step says otherwise.

## Review Focus

1. **A saved session that can't be read.** `localStorage` throws (private window, blocked site data) or holds something that is not a UUID. Expected: the welcome screen, never a crash. Pinned in Task 4 by `AppShell.test.tsx`: "ignores a stored id that is not a UUID" and "still works when localStorage is unavailable".
2. **The API is down or answers with something that isn't JSON** (nginx returns a 502 while the API restarts). Expected: a readable error and a way to retry, never a blank screen. Pinned in Task 3 by `client.test.ts` (proxy 502, network failure) and in Task 5 by `HistoryPage.test.tsx` (error alert with field details, request id and Try again). Task 10 configures nginx to find the API again after a container restart.
3. **Save clicked twice, or a retry after a lost response.** Expected: the session is stored once. Pinned in Task 9 by `LogWorkoutPage.test.tsx`: the same key on a retry after a network failure, one key across a double click, and the "already saved" banner on a replay.
4. **The local day differs from the UTC day near midnight** for coaches east of UTC (Vietnam is UTC+7). Expected: the default session date, the sample data and the comparison periods use the local calendar day. Pinned in Task 1 (Vitest's `TZ`) and Task 2 (`dates.test.ts` at 00:30 and 23:30 local).
5. **State left behind after an edit.** Field errors that point at shifted rows, or a search box that keeps its text after "Clear filters" in the empty state. Expected: errors clear on the next edit, and the search box empties. Pinned in Task 9 ("clears them on edit") and Task 5 ("shows the API message and a way out when filters match nothing").

---

### Task 1: Frontend package, toolchain and test harness

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/.oxlintrc.json`, `frontend/.prettierrc`, `frontend/index.html`, `frontend/public/favicon.svg`
- Create: `frontend/src/index.css`, `frontend/src/main.tsx` (placeholder until Task 4), `frontend/src/api/types.ts`
- Create: `frontend/src/test/setup.ts`, `frontend/src/test/server.ts`, `frontend/src/test/fixtures.ts`
- Create: `frontend/src/lib/uuid.ts`
- Test: `frontend/src/lib/uuid.test.ts`
- Modify: `tsconfig.json` (root), `.dockerignore` (root)

**Interfaces:**
- Produces, in `src/api/types.ts`: `WeightUnit` (`'kg' | 'lb'`), `WEIGHT_UNITS`, `FieldError`, `ErrorBody`, `Exercise`, `WorkoutSet`, `WorkoutEntry`, `HistoryPage`, `RecordMetric` (`'maxWeight' | 'maxVolume' | 'bestE1rm'`), `PersonalRecord`, `Records`, `PersonalRecordsResponse`, `MetricChange`, `PeriodRecords`, `ComparisonResponse`, `LogEntryInput`, `LogResult`.
- Produces, in `src/lib/uuid.ts`: `isUuid(value: string): boolean`, `shortId(id: string): string`.
- Produces, for tests: `server` in `src/test/server.ts` (MSW with default handlers: the catalog, and an empty account for history, records and comparison); `USER_ID`, `CATALOG`, `NO_RECORDS` and `makeEntry(overrides?: Partial<WorkoutEntry>): WorkoutEntry` in `src/test/fixtures.ts`; a global setup that freezes `Date` at 2026-10-16 00:30 local time and clears `localStorage` after each test.

- [ ] **Step 1: Create the branch**

The empty `frontend/` folder already exists. Skip this step if you are already in a worktree on a feature branch for this plan.

```bash
git switch -c feat/frontend main
```

- [ ] **Step 2: Create `frontend/package.json`**

`frontend/package.json`:

```json
{
  "name": "workout-log-frontend",
  "version": "0.1.0",
  "description": "React frontend for the Workout Logging API: history, personal records and workout logging",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src",
    "format": "prettier --write src",
    "format:check": "prettier --check src",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fontsource-variable/inter": "^5.3.0",
    "@tanstack/react-query": "^5.104.3",
    "clsx": "^2.1.1",
    "lucide-react": "^1.57.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "react-router": "^7.18.4"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/node": "^24.19.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "jsdom": "^30.1.3",
    "msw": "^2.15.0",
    "oxlint": "^1.88.0",
    "prettier": "^3.9.10",
    "prettier-plugin-tailwindcss": "^0.8.1",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.3",
    "vite": "^8.3.4",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 3: Install the dependencies**

```bash
cd frontend && npm install
```

Expected: about 186 packages added and `package-lock.json` created. npm 11 may warn that `msw`'s install script is "not yet covered by allowScripts". Ignore it: that script only copies a browser worker file, which this app does not use.

- [ ] **Step 4: Add the tool configuration**

`vite.config.ts` sets up React, Tailwind, the `/api` proxy and Vitest. Two test settings are unusual. `env.TZ` runs the tests in UTC+7, so code that uses the UTC day fails. `execArgv` turns off Node's own `localStorage` global: on Node 25 and later it is `undefined` unless `--localstorage-file` is given, and it hides jsdom's.

`frontend/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development: /api/x → <API_URL>/x, so the API needs no CORS.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // East of UTC, so code that reads the UTC day instead of the local day fails the date tests.
    env: { TZ: 'Asia/Ho_Chi_Minh' },
    // Node 25+ defines its own localStorage global (undefined without --localstorage-file), which hides jsdom's.
    execArgv: ['--no-experimental-webstorage'],
  },
});
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom/vitest"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`frontend/.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "vitest", "oxc", "unicorn"],
  "env": {
    "browser": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error"
  }
}
```

`frontend/.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 110,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/index.css",
  "tailwindFunctions": ["clsx"]
}
```

- [ ] **Step 5: Add the page shell and design tokens**

`index.css` holds the global look: Tailwind, the Inter font, a dark `color-scheme` and the lime glow behind the page. Everything else is utility classes in the components.

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#09090b" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Workout Log</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/public/favicon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#a3e635" />
  <path d="M9 11v10M12 9v14M20 9v14M23 11v10M12 16h8" stroke="#09090b" stroke-width="2.5" stroke-linecap="round" fill="none" />
</svg>
```

`frontend/src/index.css`:

```css
@import 'tailwindcss';
@import '@fontsource-variable/inter';

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  html {
    /* Native date pickers, selects and scrollbars render dark too. */
    color-scheme: dark;
  }

  body {
    @apply min-h-dvh bg-zinc-950 text-zinc-100 antialiased;
    background-image: radial-gradient(60rem 32rem at 50% -12rem, rgb(163 230 53 / 0.08), transparent);
    background-repeat: no-repeat;
  }
}
```

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');

// Placeholder until Task 4 mounts the app.
createRoot(root).render(
  <StrictMode>
    <p className="p-8 font-semibold text-lime-300">Workout Log</p>
  </StrictMode>,
);
```

- [ ] **Step 6: Add the API types**

These mirror the backend's response shapes (`src/workouts/workout-entry.presenter.ts`, `src/personal-records/personal-records.ts`).

`frontend/src/api/types.ts`:

```ts
// Shapes of the Workout Logging API (README "API"; src/workouts/workout-entry.presenter.ts and
// src/personal-records/personal-records.ts in the backend). Kept by hand: the API has no OpenAPI document yet.

export type WeightUnit = 'kg' | 'lb';

export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb'];

export interface FieldError {
  /** Path of the offending input, e.g. `entries[2].sets[0].weight`. */
  field: string;
  message: string;
}

/** Body of every API error response. */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  errors?: FieldError[];
  requestId?: string;
}

export interface Exercise {
  name: string;
  muscleGroups: string[];
}

export interface WorkoutSet {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

export interface WorkoutEntry {
  id: string;
  userId: string;
  /** The client's calendar day, `YYYY-MM-DD`. */
  date: string;
  exerciseName: string;
  sets: WorkoutSet[];
  createdAt: string;
}

export interface HistoryPage {
  data: WorkoutEntry[];
  page: { limit: number; nextCursor: string | null };
  /** Present only when the page is empty. */
  message?: string;
}

export type RecordMetric = 'maxWeight' | 'maxVolume' | 'bestE1rm';

export interface PersonalRecord {
  /** The metric's value in the requested unit: the weight, reps × weight, or the Epley estimate. */
  value: number;
  weight: number;
  reps: number;
  /** The day the record was first reached. */
  date: string;
  entryId: string;
}

export type Records = Record<RecordMetric, PersonalRecord | null>;

export interface PersonalRecordsResponse {
  data: { exerciseName: string; unit: WeightUnit; from: string | null; to: string | null; records: Records };
  /** Present only when there are no records. */
  message?: string;
}

export interface MetricChange {
  absolute: number;
  /** null when the baseline value is 0 (bodyweight work). */
  percent: number | null;
}

export interface PeriodRecords {
  from: string;
  to: string;
  records: Records;
}

export interface ComparisonResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    current: PeriodRecords;
    baseline: PeriodRecords;
    change: Record<RecordMetric, MetricChange | null>;
  };
  /** Present only when neither period has data. */
  message?: string;
}

/** One entry of a POST /workout-entries body. Blank numbers are sent as null so the API names the field. */
export interface LogEntryInput {
  date: string;
  exerciseName: string;
  sets: { reps: number | null; weight: number | null; unit: WeightUnit }[];
}

export interface LogResult {
  entries: WorkoutEntry[];
  /** True when the Idempotency-Key had been used before and nothing new was stored. */
  replayed: boolean;
}
```

- [ ] **Step 7: Add the test harness**

The MSW server answers like the API for an empty account. Tests override a handler with `server.use(...)`.

`frontend/src/test/fixtures.ts`:

```ts
import type { Exercise, Records, WorkoutEntry } from '../api/types';

export const USER_ID = '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e';

export const CATALOG: Exercise[] = [
  { name: 'Back Squat', muscleGroups: ['glutes', 'hamstrings', 'quadriceps'] },
  { name: 'Bench Press', muscleGroups: ['chest', 'shoulders', 'triceps'] },
  { name: 'Deadlift', muscleGroups: ['back', 'glutes', 'hamstrings'] },
  { name: 'Front Squat', muscleGroups: ['core', 'glutes', 'quadriceps'] },
  { name: 'Pull-Up', muscleGroups: ['back', 'biceps'] },
];

export const NO_RECORDS: Records = { maxWeight: null, maxVolume: null, bestE1rm: null };

let nextId = 1;

export function makeEntry(overrides: Partial<WorkoutEntry> = {}): WorkoutEntry {
  const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
  return {
    id,
    userId: USER_ID,
    date: '2026-10-14',
    exerciseName: 'Bench Press',
    sets: [{ reps: 5, weight: 100, unit: 'kg' }],
    createdAt: '2026-10-14T09:00:00.000Z',
    ...overrides,
  };
}
```

`frontend/src/test/server.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CATALOG, NO_RECORDS } from './fixtures';

/**
 * API stand-in for tests: the catalog plus an empty account. Tests replace a handler with
 * `server.use(...)`; a request no handler matches fails the test.
 */
export const server = setupServer(
  http.get('/api/exercises', () => HttpResponse.json({ data: CATALOG })),
  http.get('/api/users/:userId/workout-entries', () =>
    HttpResponse.json({
      data: [],
      page: { limit: 20, nextCursor: null },
      message: 'No workout entries match the given filters.',
    }),
  ),
  http.get('/api/users/:userId/personal-records', ({ request }) => {
    const query = new URL(request.url).searchParams;
    const exerciseName = query.get('exerciseName') ?? '';
    return HttpResponse.json({
      data: { exerciseName, unit: query.get('unit'), from: null, to: null, records: NO_RECORDS },
      message: `No ${exerciseName} entries found for this user.`,
    });
  }),
  http.get('/api/users/:userId/personal-records/comparison', ({ request }) => {
    const query = new URL(request.url).searchParams;
    const exerciseName = query.get('exerciseName') ?? '';
    return HttpResponse.json({
      data: {
        exerciseName,
        unit: query.get('unit'),
        current: { from: query.get('from'), to: query.get('to'), records: NO_RECORDS },
        baseline: { from: query.get('baselineFrom'), to: query.get('baselineTo'), records: NO_RECORDS },
        change: NO_RECORDS,
      },
      message: `No ${exerciseName} entries found for this user in either date range.`,
    });
  }),
);
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  // Every test runs on Friday 2026-10-16 at 00:30 local time, when the UTC day (in this UTC+7 zone) is still
  // 2026-10-15, so a screen that uses the UTC day fails. Only Date is faked; timers stay real for user-event and MSW.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 0, 30) });
});

afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => server.close());
```

- [ ] **Step 8: Write the failing UUID test**

`frontend/src/lib/uuid.test.ts`:

```ts
import { isUuid, shortId } from './uuid';

describe('isUuid', () => {
  it.each([
    '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e',
    '0B7E5F0E-8A39-4C1E-9D5A-2F1C3B4A5D6E',
    '00000000-0000-0000-0000-000000000000',
    '  0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e  ',
  ])('accepts %j', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '0b7e5f0e-8a39-4c1e-9d5a',
    '0b7e5f0e8a394c1e9d5a2f1c3b4a5d6e',
    '{0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e}',
    'zb7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e',
  ])('rejects %j', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('shortId', () => {
  it('keeps the first 8 and last 4 characters', () => {
    expect(shortId('0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e')).toBe('0b7e5f0e…5d6e');
  });
});
```

- [ ] **Step 9: Run it to make sure it fails**

Run: `npm test -- src/lib/uuid.test.ts`
Expected: FAIL with `Failed to resolve import "./uuid" from "src/lib/uuid.test.ts"`.

- [ ] **Step 10: Implement `uuid.ts`**

`frontend/src/lib/uuid.ts`:

```ts
/** Any UUID-shaped id (8-4-4-4-12 hex), the same rule the API applies to `userId`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/** `0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e` → `0b7e5f0e…5d6e`, for compact display. */
export function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
```

- [ ] **Step 11: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`
Expected: the tests pass, the type-check and lint print nothing, Prettier reports "All matched files use Prettier code style!", and the build ends with `✓ built`. `npm run dev` now serves a placeholder at http://localhost:5173.

- [ ] **Step 12: Keep the backend's tools out of `frontend/`**

The root `tsconfig.json` has no `include`, so the backend's `npm run typecheck` would also compile `frontend/`. The API image's build context would also upload `frontend/node_modules`.

In `tsconfig.json`, replace:

```json
  "exclude": ["node_modules", "dist"]
```

with:

```json
  "exclude": ["node_modules", "dist", "frontend"]
```

In `.dockerignore`, replace:

```text
docs
scripts
```

with:

```text
docs
scripts
frontend
```

- [ ] **Step 13: Check the backend still type-checks**

Run (repo root): `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 14: Commit**

```bash
git add tsconfig.json .dockerignore frontend
git commit -m "feat: scaffold the React frontend with Tailwind, Vitest and MSW"
```

### Task 2: Date and number formatting

**Files:**
- Create: `frontend/src/lib/dates.ts`, `frontend/src/lib/format.ts`
- Test: `frontend/src/lib/dates.test.ts`, `frontend/src/lib/format.test.ts`

**Interfaces:**
- Consumes: `WeightUnit` from `src/api/types.ts`.
- Produces, in `src/lib/dates.ts`: `DayRange { from: string; to: string }`, `toIsoDay(date: Date): string`, `todayIsoDay(now?: Date): string`, `parseIsoDay(day: string): Date`, `addDays(day: string, amount: number): string`, `formatDayHeading(day: string, today: string): string`, `formatDate(day: string): string`, `formatDayRange(from: string, to: string): string`, `PeriodPreset` (`'week' | 'month' | 'year'`), `PERIOD_PRESETS`, `PeriodComparison { current: DayRange; baseline: DayRange; currentLabel: string; baselineLabel: string }`, `comparisonPeriods(preset: PeriodPreset, today: string): PeriodComparison`.
- Produces, in `src/lib/format.ts`: `formatNumber(value)`, `formatWeight(value, unit)`, `formatSignedWeight(value, unit)`, `formatSignedPercent(value)`, `formatReps(reps)`, `formatSet({ reps, weight, unit })`, `capitalize(word)`. All return strings.

- [ ] **Step 1: Write the failing date tests**

The midnight cases matter. At 00:30 in UTC+7 the UTC day is still the previous day, so an implementation built on `toISOString()` fails here.

`frontend/src/lib/dates.test.ts`:

```ts
import {
  addDays,
  comparisonPeriods,
  formatDate,
  formatDayHeading,
  formatDayRange,
  parseIsoDay,
  todayIsoDay,
} from './dates';

// Vitest runs in Asia/Ho_Chi_Minh (UTC+7, see vite.config.ts), so a UTC-based implementation fails here.
describe('todayIsoDay', () => {
  it('reads the local calendar day just after midnight', () => {
    expect(todayIsoDay(new Date(2026, 9, 16, 0, 30))).toBe('2026-10-16');
  });

  it('reads the local calendar day just before midnight', () => {
    expect(todayIsoDay(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16');
  });
});

describe('parseIsoDay', () => {
  it('returns local midnight of that day', () => {
    const date = parseIsoDay('2026-10-14');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 14, 0]);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('formatDayHeading', () => {
  const today = '2026-10-16';

  it('names today and yesterday', () => {
    expect(formatDayHeading('2026-10-16', today)).toBe('Today');
    expect(formatDayHeading('2026-10-15', today)).toBe('Yesterday');
  });

  it('omits the year for days in the current year', () => {
    expect(formatDayHeading('2026-10-14', today)).toBe('Wed, Oct 14');
  });

  it('includes the year for other years', () => {
    expect(formatDayHeading('2025-12-29', today)).toBe('Mon, Dec 29, 2025');
  });
});

describe('formatDate and formatDayRange', () => {
  it('formats a day', () => {
    expect(formatDate('2026-09-02')).toBe('Sep 2, 2026');
  });

  it('shows the year once for a range within one year', () => {
    expect(formatDayRange('2026-09-01', '2026-09-30')).toBe('Sep 1 – Sep 30, 2026');
  });

  it('shows both years for a range across years', () => {
    expect(formatDayRange('2025-12-29', '2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});

describe('comparisonPeriods', () => {
  it('compares this month so far with all of last month', () => {
    expect(comparisonPeriods('month', '2026-10-16')).toEqual({
      current: { from: '2026-10-01', to: '2026-10-16' },
      baseline: { from: '2026-09-01', to: '2026-09-30' },
      currentLabel: 'This month',
      baselineLabel: 'Last month',
    });
  });

  it('reaches back into the previous year in January and handles leap years', () => {
    expect(comparisonPeriods('month', '2026-01-10').baseline).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(comparisonPeriods('month', '2028-03-05').baseline).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('starts weeks on Monday', () => {
    // 2026-10-16 is a Friday; 2026-10-18 is a Sunday.
    expect(comparisonPeriods('week', '2026-10-16')).toMatchObject({
      current: { from: '2026-10-12', to: '2026-10-16' },
      baseline: { from: '2026-10-05', to: '2026-10-11' },
    });
    expect(comparisonPeriods('week', '2026-10-18').current).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(comparisonPeriods('week', '2026-10-12').current).toEqual({ from: '2026-10-12', to: '2026-10-12' });
  });

  it('compares this year so far with all of last year', () => {
    expect(comparisonPeriods('year', '2026-10-16')).toMatchObject({
      current: { from: '2026-01-01', to: '2026-10-16' },
      baseline: { from: '2025-01-01', to: '2025-12-31' },
    });
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/lib/dates.test.ts`
Expected: FAIL with `Failed to resolve import "./dates"`.

- [ ] **Step 3: Implement `dates.ts`**

`frontend/src/lib/dates.ts`:

```ts
// Calendar days are `YYYY-MM-DD` strings in the browser's time zone. The client owns "today" and
// every period boundary (ADR 0002); never derive a day from `toISOString()`, which is the UTC day.

export interface DayRange {
  from: string;
  to: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIsoDay(now: Date = new Date()): string {
  return toIsoDay(now);
}

/** Local midnight of `day`. `new Date('2026-10-14')` would be UTC midnight, the previous day west of UTC. */
export function parseIsoDay(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

export function addDays(day: string, amount: number): string {
  const date = parseIsoDay(day);
  date.setDate(date.getDate() + amount);
  return toIsoDay(date);
}

const weekdayMonthDay = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const weekdayMonthDayYear = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** History group heading: "Today", "Yesterday", "Wed, Oct 14", or "Mon, Dec 29, 2025" in another year. */
export function formatDayHeading(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const format = day.slice(0, 4) === today.slice(0, 4) ? weekdayMonthDay : weekdayMonthDayYear;
  return format.format(parseIsoDay(day));
}

/** "Sep 2, 2026" */
export function formatDate(day: string): string {
  return monthDayYear.format(parseIsoDay(day));
}

/** "Sep 1 – Sep 30, 2026", or "Dec 29, 2025 – Jan 4, 2026" across years. */
export function formatDayRange(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${monthDay.format(parseIsoDay(from))} – ${formatDate(to)}`;
  }
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export type PeriodPreset = 'week' | 'month' | 'year';

export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface PeriodComparison {
  current: DayRange;
  baseline: DayRange;
  currentLabel: string;
  baselineLabel: string;
}

/** The current period up to today against the whole previous period. Weeks start on Monday. */
export function comparisonPeriods(preset: PeriodPreset, today: string): PeriodComparison {
  const date = parseIsoDay(today);
  switch (preset) {
    case 'week': {
      const daysSinceMonday = (date.getDay() + 6) % 7;
      const monday = addDays(today, -daysSinceMonday);
      return {
        current: { from: monday, to: today },
        baseline: { from: addDays(monday, -7), to: addDays(monday, -1) },
        currentLabel: 'This week',
        baselineLabel: 'Last week',
      };
    }
    case 'month': {
      const firstOfMonth = toIsoDay(new Date(date.getFullYear(), date.getMonth(), 1));
      return {
        current: { from: firstOfMonth, to: today },
        baseline: {
          from: toIsoDay(new Date(date.getFullYear(), date.getMonth() - 1, 1)),
          to: addDays(firstOfMonth, -1),
        },
        currentLabel: 'This month',
        baselineLabel: 'Last month',
      };
    }
    case 'year': {
      const year = date.getFullYear();
      return {
        current: { from: `${year}-01-01`, to: today },
        baseline: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
        currentLabel: 'This year',
        baselineLabel: 'Last year',
      };
    }
  }
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npm test -- src/lib/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing formatting tests**

`frontend/src/lib/format.test.ts`:

```ts
import {
  capitalize,
  formatNumber,
  formatReps,
  formatSet,
  formatSignedPercent,
  formatSignedWeight,
  formatWeight,
} from './format';

describe('number formatting', () => {
  it('groups thousands and keeps at most two decimals', () => {
    expect(formatNumber(1215)).toBe('1,215');
    expect(formatNumber(128.333)).toBe('128.33');
    expect(formatNumber(100.125)).toBe('100.13');
    expect(formatWeight(102.5, 'kg')).toBe('102.5 kg');
  });

  it('signs non-zero changes', () => {
    expect(formatSignedWeight(5, 'kg')).toBe('+5 kg');
    expect(formatSignedWeight(-170, 'lb')).toBe('-170 lb');
    expect(formatSignedWeight(0, 'kg')).toBe('0 kg');
    expect(formatSignedPercent(4.76)).toBe('+4.76%');
    expect(formatSignedPercent(-34)).toBe('-34%');
  });
});

describe('set formatting', () => {
  it('pluralizes reps', () => {
    expect(formatReps(1)).toBe('1 rep');
    expect(formatReps(5)).toBe('5 reps');
  });

  it('shows reps × weight, or BW for bodyweight sets', () => {
    expect(formatSet({ reps: 5, weight: 100, unit: 'kg' })).toBe('5 × 100 kg');
    expect(formatSet({ reps: 10, weight: 0, unit: 'lb' })).toBe('10 × BW');
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter', () => {
    expect(capitalize('quadriceps')).toBe('Quadriceps');
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npm test -- src/lib/format.test.ts`
Expected: FAIL with `Failed to resolve import "./format"`.

- [ ] **Step 7: Implement `format.ts`**

`frontend/src/lib/format.ts`:

```ts
import type { WeightUnit } from '../api/types';

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

/** 1215 → "1,215"; 128.333 → "128.33". */
export function formatNumber(value: number): string {
  return plain.format(value);
}

/** "102.5 kg" */
export function formatWeight(value: number, unit: WeightUnit): string {
  return `${formatNumber(value)} ${unit}`;
}

/** "+5 kg", "-170 kg", "0 kg" */
export function formatSignedWeight(value: number, unit: WeightUnit): string {
  return `${signed.format(value)} ${unit}`;
}

/** "+4.76%", "-34%", "0%" */
export function formatSignedPercent(value: number): string {
  return `${signed.format(value)}%`;
}

/** "1 rep", "5 reps" */
export function formatReps(reps: number): string {
  return `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

/** A set as "5 × 100 kg". A 0-weight set is bodyweight work: "10 × BW". */
export function formatSet(set: { reps: number; weight: number; unit: WeightUnit }): string {
  return set.weight === 0 ? `${set.reps} × BW` : `${set.reps} × ${formatWeight(set.weight, set.unit)}`;
}

/** "quadriceps" → "Quadriceps" */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
```

- [ ] **Step 8: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib
git commit -m "feat: add local-day date helpers and en-US number formatting"
```

### Task 3: API client, endpoints and query hooks

**Files:**
- Create: `frontend/src/api/client.ts`, `frontend/src/api/endpoints.ts`, `frontend/src/api/queries.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: the types from `src/api/types.ts`; `DayRange` from `src/lib/dates.ts`.
- Produces, in `src/api/client.ts`: `class ApiError extends Error` with `status: number`, `code: string`, `errors: FieldError[]`, `requestId: string | undefined` and the getter `isClientError: boolean`; `RequestOptions { method?, query?, body?, headers?, signal? }`; `ApiResult<T> { body: T; headers: Headers }`; `apiRequest<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>`.
- Produces, in `src/api/endpoints.ts`: `HISTORY_PAGE_SIZE` (20); `getExercises(signal?)`; `HistoryQuery { exerciseName?, muscleGroup?, from?, to?, unit, cursor? }`; `getHistory(userId, query, signal?)`; `getPersonalRecords(userId, exerciseName, unit, signal?)`; `ComparisonQuery { exerciseName, unit, current: DayRange, baseline: DayRange }`; `getComparison(userId, query, signal?)`; `logWorkouts(userId, entries: LogEntryInput[], idempotencyKey: string): Promise<LogResult>`.
- Produces, in `src/api/queries.ts`: `queryKeys`, `useExercises()`, `useHistory(userId, query: Omit<HistoryQuery, 'cursor'>, enabled: boolean)`, `usePersonalRecords(userId, exerciseName, unit)`, `useComparison(userId, query: ComparisonQuery)`, `useLogWorkouts(userId)` (mutation variables `{ entries: LogEntryInput[]; idempotencyKey: string }`).

- [ ] **Step 1: Write the failing client tests**

`frontend/src/api/client.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { ApiError, apiRequest } from './client';
import { getHistory, logWorkouts } from './endpoints';

describe('apiRequest', () => {
  it('sends the query without empty values and returns the JSON body', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/things', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );

    const { body } = await apiRequest<{ ok: boolean }>('/things', {
      query: { a: '1', b: '', c: undefined, d: 'x y' },
    });

    expect(body).toEqual({ ok: true });
    expect(url?.search).toBe('?a=1&d=x+y');
  });

  it('turns the API error format into an ApiError with field errors and request id', async () => {
    server.use(
      http.get('/api/things', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            errors: [{ field: 'from', message: 'from must be on or before to' }],
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
    );

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      errors: [{ field: 'from', message: 'from must be on or before to' }],
      requestId: 'req-1',
      isClientError: true,
    });
  });

  it('describes a non-JSON error response, such as a proxy 502', async () => {
    server.use(
      http.get(
        '/api/things',
        () => new HttpResponse('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'The API responded with 502 Bad Gateway',
      isClientError: false,
    });
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    server.use(http.get('/api/things', () => HttpResponse.error()));

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

describe('endpoints', () => {
  it('requests a history page with filters, unit, cursor and page size', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/users/:userId/workout-entries', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ data: [], page: { limit: 20, nextCursor: null } });
      }),
    );

    await getHistory('u-1', { exerciseName: 'squat', muscleGroup: undefined, unit: 'lb', cursor: 'c1' });

    expect(url?.pathname).toBe('/api/users/u-1/workout-entries');
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      exerciseName: 'squat',
      unit: 'lb',
      cursor: 'c1',
      limit: '20',
    });
  });

  it('posts entries with the Idempotency-Key and reports a replay', async () => {
    let request: Request | undefined;
    server.use(
      http.post('/api/users/:userId/workout-entries', ({ request: received }) => {
        request = received.clone();
        return HttpResponse.json({ data: [] }, { status: 201, headers: { 'Idempotent-Replayed': 'true' } });
      }),
    );
    const entries = [
      { date: '2026-10-16', exerciseName: 'Deadlift', sets: [{ reps: 5, weight: 140, unit: 'kg' as const }] },
    ];

    const result = await logWorkouts('u-1', entries, 'key-1');

    expect(result).toEqual({ entries: [], replayed: true });
    expect(request?.headers.get('Idempotency-Key')).toBe('key-1');
    expect(request?.headers.get('Content-Type')).toBe('application/json');
    expect(await request?.json()).toEqual({ entries });
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL with `Failed to resolve import "./client"`.

- [ ] **Step 3: Implement the client**

`fetch` gets an absolute URL built from `window.location.origin`. That is the page's own origin in the browser, and it lets Node's `fetch` work in tests.

`frontend/src/api/client.ts`:

```ts
import type { ErrorBody, FieldError } from './types';

/** The app always calls the API through the same-origin `/api` proxy (Vite in development, nginx in Docker). */
const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldError[];
  readonly requestId: string | undefined;

  constructor(body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code;
    this.errors = body.errors ?? [];
    this.requestId = body.requestId;
  }

  /** A 4xx: sending the same request again cannot succeed. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Empty and undefined values are left out of the query string. */
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  body: T;
  headers: Headers;
}

/** Sends a JSON request; any failure becomes an ApiError in the API's error format. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  // fetch outside a browser (tests) needs an absolute URL; in the browser this is the page's origin.
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(name, value);
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError({
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the API. Check that it is running.',
    });
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(
      isErrorBody(body)
        ? body
        : {
            statusCode: response.status,
            code: 'HTTP_ERROR',
            message: `The API responded with ${response.status} ${response.statusText}`.trim(),
          },
    );
  }
  return { body: body as T, headers: response.headers };
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const { statusCode, code, message } = value as Partial<ErrorBody>;
  return typeof statusCode === 'number' && typeof code === 'string' && typeof message === 'string';
}
```

- [ ] **Step 4: Implement the endpoints**

`frontend/src/api/endpoints.ts`:

```ts
import type { DayRange } from '../lib/dates';
import { apiRequest } from './client';
import type {
  ComparisonResponse,
  Exercise,
  HistoryPage,
  LogEntryInput,
  LogResult,
  PersonalRecordsResponse,
  WeightUnit,
  WorkoutEntry,
} from './types';

export const HISTORY_PAGE_SIZE = 20;

const userPath = (userId: string) => `/users/${encodeURIComponent(userId)}`;

export async function getExercises(signal?: AbortSignal): Promise<Exercise[]> {
  const { body } = await apiRequest<{ data: Exercise[] }>('/exercises', { signal });
  return body.data;
}

export interface HistoryQuery {
  /** Partial, case-insensitive match. */
  exerciseName?: string;
  muscleGroup?: string;
  from?: string;
  to?: string;
  unit: WeightUnit;
  cursor?: string;
}

export async function getHistory(
  userId: string,
  query: HistoryQuery,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const { body } = await apiRequest<HistoryPage>(`${userPath(userId)}/workout-entries`, {
    query: { ...query, limit: String(HISTORY_PAGE_SIZE) },
    signal,
  });
  return body;
}

export async function getPersonalRecords(
  userId: string,
  exerciseName: string,
  unit: WeightUnit,
  signal?: AbortSignal,
): Promise<PersonalRecordsResponse> {
  const { body } = await apiRequest<PersonalRecordsResponse>(`${userPath(userId)}/personal-records`, {
    query: { exerciseName, unit },
    signal,
  });
  return body;
}

export interface ComparisonQuery {
  exerciseName: string;
  unit: WeightUnit;
  current: DayRange;
  baseline: DayRange;
}

export async function getComparison(
  userId: string,
  query: ComparisonQuery,
  signal?: AbortSignal,
): Promise<ComparisonResponse> {
  const { body } = await apiRequest<ComparisonResponse>(`${userPath(userId)}/personal-records/comparison`, {
    query: {
      exerciseName: query.exerciseName,
      unit: query.unit,
      from: query.current.from,
      to: query.current.to,
      baselineFrom: query.baseline.from,
      baselineTo: query.baseline.to,
    },
    signal,
  });
  return body;
}

/** Bulk, all-or-nothing. Retrying with the same key never stores the entries twice (ADR 0003). */
export async function logWorkouts(
  userId: string,
  entries: LogEntryInput[],
  idempotencyKey: string,
): Promise<LogResult> {
  const { body, headers } = await apiRequest<{ data: WorkoutEntry[] }>(
    `${userPath(userId)}/workout-entries`,
    {
      method: 'POST',
      body: { entries },
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
  return { entries: body.data, replayed: headers.get('Idempotent-Replayed') === 'true' };
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npm test -- src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the query hooks**

The screen tests from Task 5 onward exercise these. `placeholderData: keepPreviousData` keeps the old results on screen, dimmed, while a new filter loads, instead of flashing skeletons.

`frontend/src/api/queries.ts`:

```ts
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ComparisonQuery,
  type HistoryQuery,
  getComparison,
  getExercises,
  getHistory,
  getPersonalRecords,
  logWorkouts,
} from './endpoints';
import type { LogEntryInput, WeightUnit } from './types';

export const queryKeys = {
  exercises: ['exercises'] as const,
  history: (userId: string) => ['history', userId] as const,
  records: (userId: string) => ['records', userId] as const,
};

/** The fixed catalog only changes with a backend deploy. */
export function useExercises() {
  return useQuery({
    queryKey: queryKeys.exercises,
    queryFn: ({ signal }) => getExercises(signal),
    staleTime: Infinity,
  });
}

export function useHistory(userId: string, query: Omit<HistoryQuery, 'cursor'>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.history(userId), query],
    queryFn: ({ pageParam, signal }) => getHistory(userId, { ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePersonalRecords(userId: string, exerciseName: string, unit: WeightUnit) {
  return useQuery({
    queryKey: [...queryKeys.records(userId), 'all-time', exerciseName, unit],
    queryFn: ({ signal }) => getPersonalRecords(userId, exerciseName, unit, signal),
    placeholderData: keepPreviousData,
    enabled: exerciseName !== '',
  });
}

export function useComparison(userId: string, query: ComparisonQuery) {
  return useQuery({
    queryKey: [...queryKeys.records(userId), 'comparison', query],
    queryFn: ({ signal }) => getComparison(userId, query, signal),
    placeholderData: keepPreviousData,
    enabled: query.exerciseName !== '',
  });
}

/** Logs entries, then marks everything derived from them (history pages and records) stale. */
export function useLogWorkouts(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entries, idempotencyKey }: { entries: LogEntryInput[]; idempotencyKey: string }) =>
      logWorkouts(userId, entries, idempotencyKey),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.history(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.records(userId) }),
      ]),
  });
}
```

- [ ] **Step 7: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api
git commit -m "feat: add the API client with structured errors and query hooks"
```

### Task 4: Session, welcome screen, app shell and routes

**Files:**
- Create: `frontend/src/session/session.tsx`, `frontend/src/providers.tsx`, `frontend/src/routes.tsx`
- Create: `frontend/src/components/ui/Button.tsx`, `frontend/src/components/ui/Card.tsx`, `frontend/src/components/ui/Field.tsx`, `frontend/src/components/ui/SegmentedControl.tsx`
- Create: `frontend/src/components/PageHeader.tsx`, `frontend/src/components/RequireUser.tsx`, `frontend/src/components/AppShell.tsx`
- Create: `frontend/src/features/welcome/WelcomePage.tsx`
- Create (placeholders replaced in Tasks 5, 7 and 9): `frontend/src/features/history/HistoryPage.tsx`, `frontend/src/features/records/RecordsPage.tsx`, `frontend/src/features/log/LogWorkoutPage.tsx`
- Create: `frontend/src/test/render.tsx`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/features/welcome/WelcomePage.test.tsx`, `frontend/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `isUuid`, `shortId`; `ApiError`; `WeightUnit`.
- Produces, in `src/session/session.tsx`: `USER_ID_KEY` (`'workout-log.userId'`), `UNIT_KEY` (`'workout-log.unit'`), `Session { userId: string | null; setUserId(id); unit: WeightUnit; setUnit(unit) }`, `SessionProvider`, `useSession(): Session`, `useActiveSession(): Session & { userId: string }` (for pages behind `RequireUser`).
- Produces, in `src/providers.tsx`: `createQueryClient(): QueryClient`, `AppProviders({ client, children })`.
- Produces UI primitives: `Button` (props: `variant?: ButtonVariant`, `size?: ButtonSize` plus button attributes, `type` defaults to `button`), `buttonClass(variant?, size?, className?)`, `ButtonVariant` (`'primary' | 'secondary' | 'ghost' | 'danger'`), `ButtonSize` (`'sm' | 'md' | 'lg'`); `Card` (div props); `Input` and `Select` (props: `label`, `hideLabel?`, `error?`, `hint?`, `className?` for the wrapper, plus native attributes; `Input` also takes `icon?` and `inputClassName?`); `SegmentedControl<T extends string>({ label, options, value, onChange, className? })`.
- Produces: `PageHeader({ title, description, actions? })`, `RequireUser({ children })`, `AppShell`, `WelcomePage`, `AppRoutes` (`/welcome`, `/history`, `/records`, `/log`; anything else redirects to `/history`), and for tests `renderApp(route, { userId?, unit? })` returning `{ user, client, ...RenderResult }`.

- [ ] **Step 1: Write the failing screen tests**

`frontend/src/features/welcome/WelcomePage.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { USER_ID_KEY } from '../../session/session';
import { USER_ID } from '../../test/fixtures';
import { renderApp } from '../../test/render';

describe('WelcomePage', () => {
  it('rejects an id that is not a UUID and stores nothing', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.type(screen.getByLabelText('Client user ID'), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText(/Enter a UUID such as/)).toBeInTheDocument();
    expect(screen.getByLabelText('Client user ID')).toHaveAttribute('aria-invalid', 'true');
    expect(window.localStorage.getItem(USER_ID_KEY)).toBeNull();
  });

  it('saves a valid id, normalized to lower case, and opens the history', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.type(screen.getByLabelText('Client user ID'), ` ${USER_ID.toUpperCase()} `);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(window.localStorage.getItem(USER_ID_KEY)).toBe(USER_ID);
  });

  it('generates a new UUID', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.click(screen.getByRole('button', { name: 'Generate a new client ID' }));

    expect(screen.getByLabelText<HTMLInputElement>('Client user ID').value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('prefills the saved id when switching clients', () => {
    renderApp('/welcome');

    expect(screen.getByLabelText('Client user ID')).toHaveValue(USER_ID);
  });
});
```

`frontend/src/components/AppShell.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { UNIT_KEY, USER_ID_KEY } from '../session/session';
import { USER_ID } from '../test/fixtures';
import { renderApp } from '../test/render';

describe('routing and app shell', () => {
  it('sends a first-time visitor to the welcome screen', () => {
    renderApp('/history', { userId: null });

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
  });

  it('ignores a stored id that is not a UUID', () => {
    window.localStorage.setItem(USER_ID_KEY, 'garbage');
    renderApp('/records', { userId: 'garbage' });

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
  });

  it('still works when localStorage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      renderApp('/history', { userId: null });
      expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it('sends unknown paths to the history', async () => {
    renderApp('/nope');

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
  });

  it('shows the client and navigates between screens', async () => {
    const { user } = renderApp('/history');

    expect(screen.getByText('0b7e5f0e…5d6e')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Personal records' }));
    expect(await screen.findByRole('heading', { name: 'Personal records' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Personal records' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(nav).getByRole('link', { name: 'Log workout' }));
    expect(await screen.findByRole('heading', { name: 'Log workout' })).toBeInTheDocument();
  });

  it('switches the display unit and remembers it', async () => {
    const { user } = renderApp('/history');
    const units = screen.getByRole('radiogroup', { name: 'Display unit' });

    expect(within(units).getByRole('radio', { name: 'kg' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(units).getByRole('radio', { name: 'lb' }));

    expect(within(units).getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem(UNIT_KEY)).toBe('lb');
  });

  it('opens the welcome screen to switch clients', async () => {
    const { user } = renderApp('/history');

    await user.click(screen.getByRole('link', { name: /Switch client/ }));

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
    expect(screen.getByLabelText('Client user ID')).toHaveValue(USER_ID);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/welcome src/components`
Expected: FAIL with `Failed to resolve import "../../session/session"`. The session store, the test renderer and the screens do not exist yet.

- [ ] **Step 3: Add the session store and providers**

`frontend/src/session/session.tsx`:

```tsx
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { WeightUnit } from '../api/types';
import { isUuid } from '../lib/uuid';

export const USER_ID_KEY = 'workout-log.userId';
export const UNIT_KEY = 'workout-log.unit';

export interface Session {
  /** The client whose workouts are shown; null until one is chosen on the welcome screen. */
  userId: string | null;
  setUserId: (userId: string) => void;
  /** The unit every weight in the app is shown and entered in by default. */
  unit: WeightUnit;
  setUnit: (unit: WeightUnit) => void;
}

const SessionContext = createContext<Session | null>(null);

/** Keeps the chosen client and display unit in localStorage so they survive reloads. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => {
    const stored = readStorage(USER_ID_KEY);
    return stored !== null && isUuid(stored) ? stored : null;
  });
  const [unit, setUnitState] = useState<WeightUnit>(() => (readStorage(UNIT_KEY) === 'lb' ? 'lb' : 'kg'));

  const setUserId = useCallback((next: string) => {
    const normalized = next.trim().toLowerCase();
    writeStorage(USER_ID_KEY, normalized);
    setUserIdState(normalized);
  }, []);

  const setUnit = useCallback((next: WeightUnit) => {
    writeStorage(UNIT_KEY, next);
    setUnitState(next);
  }, []);

  const session = useMemo(() => ({ userId, setUserId, unit, setUnit }), [userId, setUserId, unit, setUnit]);
  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/** For pages behind <RequireUser>, where a client is always chosen. */
export function useActiveSession(): Session & { userId: string } {
  const session = useSession();
  if (session.userId === null)
    throw new Error('useActiveSession needs a chosen client; wrap the page in <RequireUser>');
  return { ...session, userId: session.userId };
}

// Storage can be unavailable (private windows, blocked site data); the app then keeps the values in memory only.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory value.
  }
}
```

`frontend/src/providers.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from './api/client';
import { SessionProvider } from './session/session';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx cannot succeed on retry; network errors and 5xx get two more attempts.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Add the UI primitives**

`frontend/src/components/ui/Button.tsx`:

```tsx
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-lime-400 text-zinc-950 shadow-lg shadow-lime-400/20 hover:bg-lime-300',
  secondary: 'border border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10',
  ghost: 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
  danger: 'text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-sm',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-5 text-base',
};

/** Button styles, also for links that look like buttons: `<Link className={buttonClass('secondary')}>`. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400',
    'disabled:pointer-events-none disabled:opacity-40',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
```

`frontend/src/components/ui/Card.tsx`:

```tsx
import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-white/10 bg-zinc-900/60 shadow-xl shadow-black/20 backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  );
}
```

`frontend/src/components/ui/Field.tsx`:

```tsx
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';

interface FieldProps {
  label: string;
  /** Visually hidden label, for controls inside a table row that has column headings. */
  hideLabel?: boolean;
  error?: string | null;
  hint?: string;
  /** Classes for the wrapper, e.g. width or grid placement. */
  className?: string;
}

function controlClass(invalid: boolean, extra?: string) {
  return clsx(
    'h-10 w-full rounded-xl border bg-zinc-950/60 px-3 text-sm text-zinc-100 transition-colors',
    'placeholder:text-zinc-500 focus:ring-2 focus:outline-none',
    invalid
      ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-400/20'
      : 'border-white/10 focus:border-lime-400/60 focus:ring-lime-400/20',
    extra,
  );
}

function FieldShell({
  label,
  hideLabel,
  error,
  hint,
  className,
  controlId,
  messageId,
  children,
}: FieldProps & { controlId: string; messageId: string; children: ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={controlId}
        className={clsx('text-xs font-medium tracking-wide text-zinc-400 uppercase', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p id={messageId} className="text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Icon shown inside the input on the left. */
  icon?: ReactNode;
  inputClassName?: string;
}

export function Input({
  label,
  hideLabel,
  error,
  hint,
  className,
  icon,
  inputClassName,
  ...props
}: InputProps) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  return (
    <FieldShell {...{ label, hideLabel, error, hint, className, controlId, messageId }}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
            {icon}
          </span>
        )}
        <input
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={controlClass(Boolean(error), clsx(icon !== undefined && 'pl-9', inputClassName))}
          {...props}
        />
      </div>
    </FieldShell>
  );
}

interface SelectProps extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {}

export function Select({ label, hideLabel, error, hint, className, children, ...props }: SelectProps) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  return (
    <FieldShell {...{ label, hideLabel, error, hint, className, controlId, messageId }}>
      <div className="relative">
        <select
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={controlClass(Boolean(error), 'appearance-none pr-9')}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-zinc-500"
        />
      </div>
    </FieldShell>
  );
}
```

`frontend/src/components/ui/SegmentedControl.tsx`:

```tsx
import { clsx } from 'clsx';

interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group, e.g. "Display unit". */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('inline-flex rounded-xl border border-white/10 bg-zinc-950/60 p-1', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-lg px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400',
              selected ? 'bg-lime-400 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Add the page header, the guard and the shell**

`frontend/src/components/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-end gap-3">{actions}</div>}
    </header>
  );
}
```

`frontend/src/components/RequireUser.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from '../session/session';

/** Sends visitors who have not chosen a client to the welcome screen. */
export function RequireUser({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  return userId === null ? <Navigate to="/welcome" replace /> : children;
}
```

`frontend/src/components/AppShell.tsx`:

```tsx
import { clsx } from 'clsx';
import { ArrowLeftRight, Dumbbell, History, type LucideIcon, PlusCircle, Trophy } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import type { WeightUnit } from '../api/types';
import { shortId } from '../lib/uuid';
import { useActiveSession } from '../session/session';
import { SegmentedControl } from './ui/SegmentedControl';

interface NavItem {
  to: string;
  label: string;
  /** Label in the mobile tab bar. */
  shortLabel: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/history', label: 'History', shortLabel: 'History', icon: History },
  { to: '/records', label: 'Personal records', shortLabel: 'Records', icon: Trophy },
  { to: '/log', label: 'Log workout', shortLabel: 'Log', icon: PlusCircle },
];

const UNIT_OPTIONS: readonly { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

/** Sidebar on desktop, top bar on every size, bottom tab bar on mobile. */
export function AppShell() {
  const { userId, unit, setUnit } = useActiveSession();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-white/10 bg-zinc-950/60 px-4 py-5 lg:flex">
        <Brand />
        <nav aria-label="Main" className="mt-10 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-zinc-950/70 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SegmentedControl label="Display unit" options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
            <ClientChip userId={userId} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 sm:px-6 lg:px-10 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main mobile"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-white/10 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <TabLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/history" className="flex items-center gap-2.5 px-1 font-semibold tracking-tight">
      <span className="grid size-9 place-items-center rounded-xl bg-lime-400 text-zinc-950 shadow-lg shadow-lime-400/25">
        <Dumbbell aria-hidden="true" className="size-5" />
      </span>
      <span className="hidden sm:inline">Workout Log</span>
    </Link>
  );
}

function SidebarLink({ item: { to, label, icon: Icon } }: { item: NavItem }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon aria-hidden="true" className={clsx('size-4', isActive && 'text-lime-300')} />
          {label}
        </>
      )}
    </NavLink>
  );
}

function TabLink({ item: { to, shortLabel, icon: Icon } }: { item: NavItem }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium',
          isActive ? 'text-lime-300' : 'text-zinc-500',
        )
      }
    >
      <Icon aria-hidden="true" className="size-5" />
      {shortLabel}
    </NavLink>
  );
}

function ClientChip({ userId }: { userId: string }) {
  return (
    <Link
      to="/welcome"
      title={`Client ${userId} – switch client`}
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1 pr-3 pl-1 text-sm transition-colors hover:bg-white/10"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-lime-300 to-emerald-500 text-[11px] font-bold text-zinc-950"
      >
        {userId.slice(0, 2).toUpperCase()}
      </span>
      <span className="hidden font-mono text-xs text-zinc-300 sm:inline">{shortId(userId)}</span>
      <ArrowLeftRight aria-hidden="true" className="size-3.5 text-zinc-500" />
      <span className="sr-only">Switch client</span>
    </Link>
  );
}
```

- [ ] **Step 6: Add the welcome screen**

`frontend/src/features/welcome/WelcomePage.tsx`:

```tsx
import { ArrowRight, Dumbbell, History, Scale, Sparkles, Trophy } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { isUuid } from '../../lib/uuid';
import { useSession } from '../../session/session';

const FEATURES = [
  { icon: History, text: 'History filtered by exercise, muscle group and date' },
  { icon: Trophy, text: 'Heaviest set, best volume set and estimated 1RM' },
  { icon: Scale, text: 'Log and read every weight in kg or lb' },
];

export function WelcomePage() {
  const { userId, setUserId } = useSession();
  const navigate = useNavigate();
  const [value, setValue] = useState(userId ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isUuid(value)) {
      setError('Enter a UUID such as 0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
      return;
    }
    setUserId(value);
    navigate('/history');
  }

  function update(next: string) {
    setValue(next);
    setError(null);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:px-10">
      <section>
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          <Dumbbell aria-hidden="true" className="size-3.5 text-lime-300" />
          Workout Log
        </p>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          Every rep logged.
          <span className="block bg-linear-to-r from-lime-300 to-emerald-400 bg-clip-text text-transparent">
            Every record earned.
          </span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-zinc-400">
          Open a client&apos;s training history and personal records with their user ID.
        </p>
        <ul className="mt-8 space-y-3">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
              <span className="grid size-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
                <Icon aria-hidden="true" className="size-4 text-lime-300" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </section>

      <Card className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Choose a client</h2>
        <p className="mt-1 text-sm text-zinc-400">
          The ID is saved in this browser, so next time you go straight to their history.
        </p>
        <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Client user ID"
            value={value}
            onChange={(event) => update(event.target.value)}
            placeholder="0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e"
            autoComplete="off"
            spellCheck={false}
            inputClassName="font-mono"
            error={error}
          />
          <Button type="submit" size="lg" className="w-full">
            Continue
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => update(crypto.randomUUID())}>
            <Sparkles aria-hidden="true" className="size-4" />
            Generate a new client ID
          </Button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7: Add placeholder pages**

Tasks 5, 7 and 9 replace these.

`frontend/src/features/history/HistoryPage.tsx`:

```tsx
import { PageHeader } from '../../components/PageHeader';

// Placeholder until Task 5.
export function HistoryPage() {
  return <PageHeader title="Workout history" description="Every logged exercise, newest first." />;
}
```

`frontend/src/features/records/RecordsPage.tsx`:

```tsx
import { PageHeader } from '../../components/PageHeader';

// Placeholder until Task 7.
export function RecordsPage() {
  return (
    <PageHeader
      title="Personal records"
      description="All-time bests for one exercise, with the day each was set."
    />
  );
}
```

`frontend/src/features/log/LogWorkoutPage.tsx`:

```tsx
import { PageHeader } from '../../components/PageHeader';

// Placeholder until Task 9.
export function LogWorkoutPage() {
  return (
    <PageHeader
      title="Log workout"
      description="Record one session. Weights are stored as entered and converted wherever they are shown."
    />
  );
}
```

- [ ] **Step 8: Add the routes and the test renderer, and mount the app**

`frontend/src/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { RequireUser } from './components/RequireUser';
import { HistoryPage } from './features/history/HistoryPage';
import { LogWorkoutPage } from './features/log/LogWorkoutPage';
import { RecordsPage } from './features/records/RecordsPage';
import { WelcomePage } from './features/welcome/WelcomePage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        element={
          <RequireUser>
            <AppShell />
          </RequireUser>
        }
      >
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/log" element={<LogWorkoutPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/history" replace />} />
    </Routes>
  );
}
```

`frontend/src/test/render.tsx`:

```tsx
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { WeightUnit } from '../api/types';
import { AppProviders, createQueryClient } from '../providers';
import { AppRoutes } from '../routes';
import { UNIT_KEY, USER_ID_KEY } from '../session/session';
import { USER_ID } from './fixtures';

interface RenderAppOptions {
  /** Client id stored before rendering; null for a first visit. */
  userId?: string | null;
  unit?: WeightUnit;
}

/** Renders the real routes at `route` with a fresh query cache, as a returning visitor by default. */
export function renderApp(route: string, { userId = USER_ID, unit = 'kg' }: RenderAppOptions = {}) {
  if (userId !== null) window.localStorage.setItem(USER_ID_KEY, userId);
  window.localStorage.setItem(UNIT_KEY, unit);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const user = userEvent.setup();
  const view = render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return { user, client, ...view };
}
```

Replace the whole of `frontend/src/main.tsx` with:

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { AppProviders, createQueryClient } from './providers';
import { AppRoutes } from './routes';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
```

- [ ] **Step 9: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 10: Look at it**

Run `npm run dev` and open http://localhost:5173. The welcome screen does not need the API. Generate an ID and press Continue: the shell opens on the History placeholder. Narrow the window below 1024 px: the sidebar gives way to the bottom tab bar.

- [ ] **Step 11: Commit**

```bash
git add frontend/src
git commit -m "feat: add the welcome screen, saved client session and app shell"
```

### Task 5: History screen

**Files:**
- Create: `frontend/src/components/ui/Alert.tsx`, `frontend/src/components/ui/EmptyState.tsx`, `frontend/src/components/ui/Skeleton.tsx`, `frontend/src/components/ApiErrorAlert.tsx`
- Create: `frontend/src/features/history/history-filters.ts`, `frontend/src/features/history/history-view.ts`, `frontend/src/features/history/HistoryFilters.tsx`, `frontend/src/features/history/EntryCard.tsx`
- Modify (replace the placeholder): `frontend/src/features/history/HistoryPage.tsx`
- Test: `frontend/src/features/history/history-filters.test.ts`, `frontend/src/features/history/history-view.test.ts`, `frontend/src/features/history/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `useExercises`, `useHistory`; `useActiveSession`; `PageHeader`, `Button`, `buttonClass`, `Card`, `Input`, `Select`; `formatDayHeading`, `todayIsoDay`, `formatSet`, `formatWeight`, `capitalize`.
- Produces: `Alert({ tone?: 'error' | 'success' | 'info', title, children?, onDismiss?, className? })`, `EmptyState({ icon: LucideIcon, title, description, children? })`, `Skeleton({ className? })`, `ApiErrorAlert({ error: unknown, className? })`.
- Produces, in `history-filters.ts`: `HistoryFilters { exercise; muscleGroup; from; to }` (all strings; URL params `exercise`, `muscle`, `from`, `to`), `filtersFromParams(params)`, `filtersToParams(filters)`, `hasActiveFilters(filters)`, `dateRangeError(filters): string | null`.
- Produces, in `history-view.ts`: `DayGroup { day; entries }`, `groupByDay(entries)`, `EntryStats { setCount; volume; topWeight }`, `entryStats(sets)`, `muscleGroupOptions(exercises)`, `muscleGroupsByExercise(exercises)`.
- Produces: `SEARCH_DEBOUNCE_MS` (300), `HistoryFilterBar({ filters, muscleGroups, rangeError, onChange(patch), onClear })`, `EntryCard({ entry, muscleGroups })`, `HistoryLocationState { flash?: string }` (the router state Task 9 sets after saving), `HistoryPage`.

- [ ] **Step 1: Write the failing filter tests**

`frontend/src/features/history/history-filters.test.ts`:

```ts
import { dateRangeError, filtersFromParams, filtersToParams, hasActiveFilters } from './history-filters';

describe('history filters', () => {
  it('reads filters from the URL, defaulting to empty', () => {
    expect(filtersFromParams(new URLSearchParams('exercise=squat&muscle=glutes&from=2026-09-01'))).toEqual({
      exercise: 'squat',
      muscleGroup: 'glutes',
      from: '2026-09-01',
      to: '',
    });
  });

  it('writes only non-empty, trimmed filters', () => {
    const params = filtersToParams({ exercise: '  squat ', muscleGroup: '', from: '', to: '2026-09-30' });
    expect(params.toString()).toBe('exercise=squat&to=2026-09-30');
  });

  it('round-trips', () => {
    const filters = { exercise: 'bench', muscleGroup: 'chest', from: '2026-09-01', to: '2026-09-30' };
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters);
  });

  it('knows when any filter is set', () => {
    expect(hasActiveFilters({ exercise: '', muscleGroup: '', from: '', to: '' })).toBe(false);
    expect(hasActiveFilters({ exercise: ' ', muscleGroup: '', from: '', to: '' })).toBe(false);
    expect(hasActiveFilters({ exercise: '', muscleGroup: 'back', from: '', to: '' })).toBe(true);
  });

  it('flags a range that ends before it starts', () => {
    const base = { exercise: '', muscleGroup: '' };
    expect(dateRangeError({ ...base, from: '2026-10-02', to: '2026-10-01' })).toBe(
      'From must be on or before To',
    );
    expect(dateRangeError({ ...base, from: '2026-10-01', to: '2026-10-01' })).toBeNull();
    expect(dateRangeError({ ...base, from: '2026-10-02', to: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/history/history-filters.test.ts`
Expected: FAIL with `Failed to resolve import "./history-filters"`.

- [ ] **Step 3: Implement `history-filters.ts`**

`frontend/src/features/history/history-filters.ts`:

```ts
/** History filters as kept in the URL (`?exercise=squat&muscle=glutes&from=…&to=…`), so reloads and links keep them. */
export interface HistoryFilters {
  exercise: string;
  muscleGroup: string;
  from: string;
  to: string;
}

const PARAM_NAMES: Record<keyof HistoryFilters, string> = {
  exercise: 'exercise',
  muscleGroup: 'muscle',
  from: 'from',
  to: 'to',
};

const FILTER_KEYS = Object.keys(PARAM_NAMES) as (keyof HistoryFilters)[];

export function filtersFromParams(params: URLSearchParams): HistoryFilters {
  return {
    exercise: params.get(PARAM_NAMES.exercise) ?? '',
    muscleGroup: params.get(PARAM_NAMES.muscleGroup) ?? '',
    from: params.get(PARAM_NAMES.from) ?? '',
    to: params.get(PARAM_NAMES.to) ?? '',
  };
}

export function filtersToParams(filters: HistoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value !== '') params.set(PARAM_NAMES[key], value);
  }
  return params;
}

export function hasActiveFilters(filters: HistoryFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key].trim() !== '');
}

/** The API rejects from > to with a 400; the page shows this next to the field instead of sending it. */
export function dateRangeError(filters: HistoryFilters): string | null {
  return filters.from !== '' && filters.to !== '' && filters.from > filters.to
    ? 'From must be on or before To'
    : null;
}
```

- [ ] **Step 4: Write the failing grouping and stats tests**

`frontend/src/features/history/history-view.test.ts`:

```ts
import { CATALOG, makeEntry } from '../../test/fixtures';
import { entryStats, groupByDay, muscleGroupOptions, muscleGroupsByExercise } from './history-view';

describe('groupByDay', () => {
  it('groups adjacent entries of the same day, keeping the order', () => {
    const a = makeEntry({ date: '2026-10-14' });
    const b = makeEntry({ date: '2026-10-14' });
    const c = makeEntry({ date: '2026-10-10' });

    expect(groupByDay([a, b, c])).toEqual([
      { day: '2026-10-14', entries: [a, b] },
      { day: '2026-10-10', entries: [c] },
    ]);
  });

  it('returns no groups for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('entryStats', () => {
  it('counts sets, sums volume and finds the top weight', () => {
    const stats = entryStats([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 3, weight: 105, unit: 'kg' },
    ]);
    expect(stats).toEqual({ setCount: 2, volume: 815, topWeight: 105 });
  });

  it('rounds float sums to 2 decimals', () => {
    expect(entryStats([{ reps: 3, weight: 220.46, unit: 'lb' }]).volume).toBe(661.38);
  });

  it('handles bodyweight sets', () => {
    expect(entryStats([{ reps: 10, weight: 0, unit: 'kg' }])).toEqual({
      setCount: 1,
      volume: 0,
      topWeight: 0,
    });
  });
});

describe('catalog helpers', () => {
  it('lists each muscle group once, alphabetically', () => {
    expect(muscleGroupOptions(CATALOG)).toEqual([
      'back',
      'biceps',
      'chest',
      'core',
      'glutes',
      'hamstrings',
      'quadriceps',
      'shoulders',
      'triceps',
    ]);
  });

  it('maps exercise names to their muscle groups', () => {
    expect(muscleGroupsByExercise(CATALOG).get('Pull-Up')).toEqual(['back', 'biceps']);
  });
});
```

- [ ] **Step 5: Run them to make sure they fail**

Run: `npm test -- src/features/history/history-view.test.ts`
Expected: FAIL with `Failed to resolve import "./history-view"`.

- [ ] **Step 6: Implement `history-view.ts`**

`frontend/src/features/history/history-view.ts`:

```ts
import type { Exercise, WorkoutEntry, WorkoutSet } from '../../api/types';

export interface DayGroup {
  day: string;
  entries: WorkoutEntry[];
}

/** Groups entries by day. The API returns them newest day first, so equal days are always adjacent. */
export function groupByDay(entries: readonly WorkoutEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last !== undefined && last.day === entry.date) last.entries.push(entry);
    else groups.push({ day: entry.date, entries: [entry] });
  }
  return groups;
}

export interface EntryStats {
  setCount: number;
  /** Sum of reps × weight, rounded to 2 decimals. Display only: records come from the API. */
  volume: number;
  topWeight: number;
}

export function entryStats(sets: readonly WorkoutSet[]): EntryStats {
  let volume = 0;
  let topWeight = 0;
  for (const set of sets) {
    volume += set.reps * set.weight;
    topWeight = Math.max(topWeight, set.weight);
  }
  return { setCount: sets.length, volume: Math.round(volume * 100) / 100, topWeight };
}

/** Every muscle group in the catalog, alphabetical, for the filter. */
export function muscleGroupOptions(exercises: readonly Exercise[]): string[] {
  return [...new Set(exercises.flatMap((exercise) => exercise.muscleGroups))].sort();
}

export function muscleGroupsByExercise(exercises: readonly Exercise[]): Map<string, string[]> {
  return new Map(exercises.map((exercise) => [exercise.name, exercise.muscleGroups]));
}
```

- [ ] **Step 7: Write the failing screen tests**

`frontend/src/features/history/HistoryPage.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { HistoryPage } from '../../api/types';
import { USER_ID, makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

/** Serves `pages` in order (the cursor of page n is `c<n>`) and records every request URL. */
function serveHistory(...pages: HistoryPage['data'][]) {
  const requests: URL[] = [];
  server.use(
    http.get('/api/users/:userId/workout-entries', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const index = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')!.slice(1)) : 0;
      const data = pages[index] ?? [];
      return HttpResponse.json({
        data,
        page: { limit: 20, nextCursor: index + 1 < pages.length ? `c${index + 1}` : null },
        ...(data.length === 0 ? { message: 'No workout entries match the given filters.' } : {}),
      });
    }),
  );
  return requests;
}

describe('HistoryPage', () => {
  it('lists entries grouped by day with their sets, stats and muscle groups', async () => {
    const requests = serveHistory([
      makeEntry({
        date: '2026-10-16',
        exerciseName: 'Bench Press',
        sets: [
          { reps: 5, weight: 100, unit: 'kg' },
          { reps: 3, weight: 105, unit: 'kg' },
        ],
      }),
      makeEntry({ date: '2026-10-14', exerciseName: 'Pull-Up', sets: [{ reps: 10, weight: 0, unit: 'kg' }] }),
    ]);
    renderApp('/history');

    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
    expect(within(today).getByText('5 × 100 kg')).toBeInTheDocument();
    expect(within(today).getByText('3 × 105 kg')).toBeInTheDocument();
    expect(within(today).getByText('815 kg')).toBeInTheDocument();
    expect(within(today).getByText('chest')).toBeInTheDocument();

    const earlier = screen.getByRole('region', { name: 'Wed, Oct 14' });
    expect(within(earlier).getByText('10 × BW')).toBeInTheDocument();
    expect(screen.getByText("That's every entry.")).toBeInTheDocument();

    expect(requests[0]?.pathname).toBe(`/api/users/${USER_ID}/workout-entries`);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({ unit: 'kg', limit: '20' });
  });

  it('requests weights in the display unit', async () => {
    const requests = serveHistory([makeEntry({ sets: [{ reps: 5, weight: 220.46, unit: 'lb' }] })]);
    renderApp('/history', { unit: 'lb' });

    expect(await screen.findByText('5 × 220.46 lb')).toBeInTheDocument();
    expect(requests[0]?.searchParams.get('unit')).toBe('lb');
  });

  it('searches by exercise after typing pauses and keeps the filter in the URL', async () => {
    const requests = serveHistory([makeEntry()]);
    const { user } = renderApp('/history');
    await screen.findByText('5 × 100 kg');

    await user.type(screen.getByLabelText('Exercise'), 'squat');

    await waitFor(() => expect(requests.at(-1)?.searchParams.get('exerciseName')).toBe('squat'));
    // Debounced: no request for the partial words typed on the way.
    expect(requests.map((url) => url.searchParams.get('exerciseName'))).toEqual([null, 'squat']);
  });

  it('applies filters from the URL on load', async () => {
    const requests = serveHistory([makeEntry()]);
    renderApp('/history?exercise=bench&muscle=chest&from=2026-10-01&to=2026-10-15');

    await screen.findByText('5 × 100 kg');
    expect(screen.getByLabelText('Exercise')).toHaveValue('bench');
    expect(screen.getByLabelText('Muscle group')).toHaveValue('chest');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'bench',
      muscleGroup: 'chest',
      from: '2026-10-01',
      to: '2026-10-15',
      unit: 'kg',
      limit: '20',
    });
  });

  it('filters by muscle group and date range', async () => {
    const requests = serveHistory([makeEntry()]);
    const { user } = renderApp('/history');
    await screen.findByText('5 × 100 kg');

    await user.selectOptions(screen.getByLabelText('Muscle group'), 'glutes');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });

    await waitFor(() =>
      expect(Object.fromEntries(requests.at(-1)?.searchParams ?? [])).toEqual({
        muscleGroup: 'glutes',
        from: '2026-09-01',
        to: '2026-09-30',
        unit: 'kg',
        limit: '20',
      }),
    );
  });

  it('flags a date range that ends before it starts, without asking the API', async () => {
    const requests = serveHistory([makeEntry()]);
    renderApp('/history?from=2026-10-10&to=2026-10-01');

    expect(await screen.findByText('From must be on or before To')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('loads the next page with the cursor', async () => {
    const requests = serveHistory(
      [makeEntry({ exerciseName: 'Bench Press' })],
      [makeEntry({ exerciseName: 'Deadlift', date: '2026-10-01' })],
    );
    const { user } = renderApp('/history');
    await screen.findByRole('heading', { name: 'Bench Press' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('heading', { name: 'Deadlift' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
    expect(requests[1]?.searchParams.get('cursor')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows the API message and a way out when filters match nothing', async () => {
    serveHistory([]);
    const { user } = renderApp('/history?exercise=curl');

    expect(await screen.findByText('No workout entries match the given filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('heading', { name: 'No workouts yet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Exercise')).toHaveValue('');
  });

  it('shows API errors with field details and the request id, and can retry', async () => {
    let fail = true;
    server.use(
      http.get('/api/users/:userId/workout-entries', () =>
        fail
          ? HttpResponse.json(
              {
                statusCode: 400,
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                errors: [{ field: 'muscleGroup', message: 'Unknown muscle group "neck"' }],
                requestId: 'req-42',
              },
              { status: 400 },
            )
          : HttpResponse.json({ data: [makeEntry()], page: { limit: 20, nextCursor: null } }),
      ),
    );
    const { user } = renderApp('/history?muscle=neck');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Request validation failed');
    expect(alert).toHaveTextContent('muscleGroup: Unknown muscle group "neck"');
    expect(alert).toHaveTextContent('Request ID req-42');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('5 × 100 kg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run them to make sure they fail**

Run: `npm test -- src/features/history/HistoryPage.test.tsx`
Expected: FAIL. The placeholder page has no entries or filters, so you get errors such as `Unable to find role="region" and name "Today"` and `Unable to find a label with the text of: Exercise`.

- [ ] **Step 9: Add the feedback primitives**

`frontend/src/components/ui/Alert.tsx`:

```tsx
import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';

const TONES = {
  error: {
    icon: CircleAlert,
    box: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    iconColor: 'text-rose-300',
  },
  success: {
    icon: CircleCheck,
    box: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    iconColor: 'text-emerald-300',
  },
  info: { icon: Info, box: 'border-sky-400/30 bg-sky-500/10 text-sky-100', iconColor: 'text-sky-300' },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { icon: Icon, box, iconColor } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', box, className)}
    >
      <Icon aria-hidden="true" className={clsx('mt-0.5 size-4 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 opacity-80">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 h-fit rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
```

`frontend/src/components/ui/EmptyState.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Actions, such as buttons. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-lime-400/10 ring-1 ring-lime-400/20">
        <Icon aria-hidden="true" className="size-7 text-lime-300" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-400">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-start justify-center gap-3">{children}</div>}
    </div>
  );
}
```

`frontend/src/components/ui/Skeleton.tsx`:

```tsx
import { clsx } from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={clsx('rounded-lg bg-white/5 motion-safe:animate-pulse', className)} />
  );
}
```

`frontend/src/components/ApiErrorAlert.tsx`:

```tsx
import { ApiError } from '../api/client';
import { Alert } from './ui/Alert';

/** Shows an API error as the API reported it: message, each field error, and the request id for the logs. */
export function ApiErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!(error instanceof ApiError)) {
    return (
      <Alert tone="error" title="Something went wrong" className={className}>
        {error instanceof Error ? error.message : String(error)}
      </Alert>
    );
  }
  return (
    <Alert tone="error" title={error.message} className={className}>
      {error.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {error.errors.map((fieldError) => (
            <li key={`${fieldError.field}:${fieldError.message}`}>
              <code className="font-mono text-xs">{fieldError.field}</code>: {fieldError.message}
            </li>
          ))}
        </ul>
      )}
      {error.requestId && <p className="mt-1 font-mono text-xs opacity-70">Request ID {error.requestId}</p>}
    </Alert>
  );
}
```

- [ ] **Step 10: Add the filter bar and the entry card**

The search box keeps its own text, so typing stays responsive while the URL updates 300 ms after the last keystroke. When the URL changes from outside (Clear filters in the empty state, Back), the box follows. It compares the trimmed text so a trailing space the coach is still typing after is kept.

`frontend/src/features/history/HistoryFilters.tsx`:

```tsx
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Field';
import { capitalize } from '../../lib/format';
import { type HistoryFilters, hasActiveFilters } from './history-filters';

/** Typing pauses this long before the search reaches the URL and the API. */
export const SEARCH_DEBOUNCE_MS = 300;

interface HistoryFilterBarProps {
  filters: HistoryFilters;
  muscleGroups: readonly string[];
  rangeError: string | null;
  onChange: (patch: Partial<HistoryFilters>) => void;
  onClear: () => void;
}

export function HistoryFilterBar({
  filters,
  muscleGroups,
  rangeError,
  onChange,
  onClear,
}: HistoryFilterBarProps) {
  const [search, setSearch] = useState(filters.exercise);
  const [seenExercise, setSeenExercise] = useState(filters.exercise);
  const timer = useRef<number | undefined>(undefined);

  // The URL changed outside this input (Clear filters in the empty state, Back): show the new value.
  // Comparing with the trimmed text keeps a trailing space the user is still typing after.
  if (filters.exercise !== seenExercise) {
    setSeenExercise(filters.exercise);
    if (filters.exercise !== search.trim()) setSearch(filters.exercise);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleSearch(value: string) {
    setSearch(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange({ exercise: value.trim() }), SEARCH_DEBOUNCE_MS);
  }

  function handleClear() {
    window.clearTimeout(timer.current);
    setSearch('');
    onClear();
  }

  return (
    <Card className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-start">
      <Input
        label="Exercise"
        className="col-span-2 lg:col-span-1"
        type="search"
        placeholder="Search, e.g. squat"
        icon={<Search aria-hidden="true" className="size-4" />}
        value={search}
        onChange={(event) => handleSearch(event.target.value)}
      />
      <Select
        label="Muscle group"
        className="col-span-2 lg:col-span-1"
        value={filters.muscleGroup}
        onChange={(event) => onChange({ muscleGroup: event.target.value })}
      >
        <option value="">All muscle groups</option>
        {muscleGroups.map((group) => (
          <option key={group} value={group}>
            {capitalize(group)}
          </option>
        ))}
      </Select>
      <Input
        label="From"
        type="date"
        value={filters.from}
        onChange={(event) => onChange({ from: event.target.value })}
        error={rangeError}
      />
      <Input
        label="To"
        type="date"
        value={filters.to}
        onChange={(event) => onChange({ to: event.target.value })}
      />
      <Button
        variant="ghost"
        className="col-span-2 lg:col-span-1 lg:mt-[1.375rem]"
        onClick={handleClear}
        disabled={!hasActiveFilters(filters) && search === ''}
      >
        <X aria-hidden="true" className="size-4" />
        Clear
      </Button>
    </Card>
  );
}
```

`frontend/src/features/history/EntryCard.tsx`:

```tsx
import type { WorkoutEntry } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { formatSet, formatWeight } from '../../lib/format';
import { entryStats } from './history-view';

export function EntryCard({ entry, muscleGroups }: { entry: WorkoutEntry; muscleGroups: readonly string[] }) {
  const stats = entryStats(entry.sets);
  // History is requested in one display unit, so every set shares it.
  const unit = entry.sets[0]?.unit ?? 'kg';
  return (
    <Card className="p-4 transition-colors hover:border-white/20 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-50">{entry.exerciseName}</h3>
          {muscleGroups.length > 0 && (
            <ul aria-label="Muscle groups" className="mt-1.5 flex flex-wrap gap-1.5">
              {muscleGroups.map((group) => (
                <li
                  key={group}
                  className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-400 capitalize"
                >
                  {group}
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="flex gap-6 text-right">
          <Stat label="Sets" value={String(stats.setCount)} />
          <Stat label="Volume" value={formatWeight(stats.volume, unit)} />
          <Stat label="Top set" value={stats.topWeight === 0 ? 'BW' : formatWeight(stats.topWeight, unit)} />
        </dl>
      </div>
      <ol aria-label="Sets" className="mt-4 flex flex-wrap gap-2">
        {entry.sets.map((set, index) => (
          // Sets have no id; their position is their identity (set 1, set 2, ...).
          <li
            key={index}
            className="rounded-lg bg-zinc-800/70 px-2.5 py-1 text-sm text-zinc-200 tabular-nums ring-1 ring-white/5"
          >
            <span className="mr-1.5 text-xs text-zinc-500">{index + 1}</span>
            {formatSet(set)}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="text-sm font-semibold text-zinc-100 tabular-nums">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 11: Replace the placeholder page**

Replace the whole of `frontend/src/features/history/HistoryPage.tsx` with:

`frontend/src/features/history/HistoryPage.tsx`:

```tsx
import { clsx } from 'clsx';
import { Dumbbell, Loader2, Plus, SearchX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useExercises, useHistory } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClass } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatDayHeading, todayIsoDay } from '../../lib/dates';
import { useActiveSession } from '../../session/session';
import { EntryCard } from './EntryCard';
import {
  type HistoryFilters,
  dateRangeError,
  filtersFromParams,
  filtersToParams,
  hasActiveFilters,
} from './history-filters';
import { HistoryFilterBar } from './HistoryFilters';
import { groupByDay, muscleGroupOptions, muscleGroupsByExercise } from './history-view';

/** Router state the log page leaves behind after saving, shown once as a success banner. */
export interface HistoryLocationState {
  flash?: string;
}

function flashFrom(state: unknown): string | null {
  return typeof state === 'object' &&
    state !== null &&
    typeof (state as HistoryLocationState).flash === 'string'
    ? ((state as HistoryLocationState).flash ?? null)
    : null;
}

export function HistoryPage() {
  const { userId, unit } = useActiveSession();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState(() => flashFrom(location.state));

  // Drop the flash from history state so a reload or Back does not show it again.
  useEffect(() => {
    if (flashFrom(location.state) !== null)
      navigate({ search: location.search }, { replace: true, state: null });
  }, [location.state, location.search, navigate]);

  const filters = filtersFromParams(params);
  const rangeError = dateRangeError(filters);
  const exercises = useExercises();
  const catalog = exercises.data ?? [];
  const history = useHistory(
    userId,
    {
      exerciseName: filters.exercise || undefined,
      muscleGroup: filters.muscleGroup || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      unit,
    },
    rangeError === null,
  );

  const updateFilters = useCallback(
    (patch: Partial<HistoryFilters>) =>
      setParams((current) => filtersToParams({ ...filtersFromParams(current), ...patch }), { replace: true }),
    [setParams],
  );
  const clearFilters = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const entries = history.data?.pages.flatMap((page) => page.data) ?? [];
  const groupsByExercise = muscleGroupsByExercise(catalog);
  const today = todayIsoDay();

  let content;
  if (rangeError !== null) {
    content = null;
  } else if (history.isPending) {
    content = (
      <div className="space-y-3" aria-label="Loading workouts">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  } else if (history.isError) {
    content = (
      <div className="space-y-3">
        <ApiErrorAlert error={history.error} />
        <Button variant="secondary" onClick={() => void history.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    content = hasActiveFilters(filters) ? (
      <EmptyState
        icon={SearchX}
        title="No matching workouts"
        description={history.data.pages[0]?.message ?? 'No workout entries match the given filters.'}
      >
        <Button variant="secondary" onClick={clearFilters}>
          Clear filters
        </Button>
      </EmptyState>
    ) : (
      <EmptyState
        icon={Dumbbell}
        title="No workouts yet"
        description="Log this client's first session to see it here."
      >
        <Link to="/log" className={buttonClass('primary')}>
          <Plus aria-hidden="true" className="size-4" />
          Log workout
        </Link>
      </EmptyState>
    );
  } else {
    content = (
      <div className={clsx('space-y-8 transition-opacity', history.isPlaceholderData && 'opacity-60')}>
        {groupByDay(entries).map((group) => (
          <section key={group.day} aria-labelledby={`day-${group.day}`}>
            <h2
              id={`day-${group.day}`}
              className="sticky top-16 z-10 -mx-1 mb-3 bg-zinc-950/80 px-1 py-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase backdrop-blur"
            >
              {formatDayHeading(group.day, today)}
            </h2>
            <ul className="space-y-3">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} muscleGroups={groupsByExercise.get(entry.exerciseName) ?? []} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="flex justify-center pt-2">
          {history.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage && (
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              )}
              Load more
            </Button>
          ) : (
            <p className="text-sm text-zinc-500">That&apos;s every entry.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Workout history"
        description="Every logged exercise, newest first."
        actions={
          // Phones have the Log tab in the bottom bar.
          <Link to="/log" className={buttonClass('primary', 'md', 'max-sm:hidden')}>
            <Plus aria-hidden="true" className="size-4" />
            Log workout
          </Link>
        }
      />
      {flash && <Alert tone="success" title={flash} onDismiss={() => setFlash(null)} className="mb-6" />}
      {exercises.isError && <ApiErrorAlert error={exercises.error} className="mb-6" />}
      <HistoryFilterBar
        filters={filters}
        muscleGroups={muscleGroupOptions(catalog)}
        rangeError={rangeError}
        onChange={updateFilters}
        onClear={clearFilters}
      />
      <div className="mt-8">{content}</div>
    </>
  );
}
```

- [ ] **Step 12: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add frontend/src
git commit -m "feat: add the history screen with URL filters and cursor paging"
```

### Task 6: Sample data

**Files:**
- Create: `frontend/src/features/sample-data/sample-workouts.ts`, `frontend/src/features/sample-data/LoadSampleDataButton.tsx`
- Modify: `frontend/src/features/history/HistoryPage.tsx`
- Test: `frontend/src/features/sample-data/sample-workouts.test.ts`, `frontend/src/features/sample-data/LoadSampleDataButton.test.tsx`

**Interfaces:**
- Consumes: `useLogWorkouts`; `addDays`, `todayIsoDay`; `useActiveSession`; `Button`, `ButtonVariant`, `ButtonSize`.
- Produces: `buildSampleWorkouts(today: string): LogEntryInput[]` (48 entries over eight weeks ending `today`), `sampleDataKey(userId: string): string`, `LoadSampleDataButton({ variant?, size? })`.

- [ ] **Step 1: Write the failing generator tests**

`frontend/src/features/sample-data/sample-workouts.test.ts`:

```ts
import { buildSampleWorkouts, sampleDataKey } from './sample-workouts';

// The backend's seeded catalog (migrations/0002_seed_exercise_catalog.sql).
const CATALOG_NAMES = [
  'Back Squat',
  'Barbell Row',
  'Bench Press',
  'Bicep Curl',
  'Calf Raise',
  'Deadlift',
  'Front Squat',
  'Hip Thrust',
  'Incline Bench Press',
  'Lat Pulldown',
  'Leg Press',
  'Overhead Press',
  'Pull-Up',
  'Romanian Deadlift',
  'Tricep Pushdown',
  'Walking Lunge',
];

describe('buildSampleWorkouts', () => {
  const entries = buildSampleWorkouts('2026-10-16');
  const sets = entries.flatMap((entry) => entry.sets);

  it('fits in one request', () => {
    expect(entries).toHaveLength(48);
    for (const entry of entries) expect(entry.sets.length).toBeLessThanOrEqual(50);
  });

  it('spans the eight weeks up to today, never the future', () => {
    const dates = entries.map((entry) => entry.date).sort();
    expect(dates[0]).toBe('2026-08-25');
    expect(dates.at(-1)).toBe('2026-10-16');
  });

  it('covers this month and last month, so the default comparison has data', () => {
    expect(entries.some((entry) => entry.date.startsWith('2026-10'))).toBe(true);
    expect(entries.some((entry) => entry.date.startsWith('2026-09'))).toBe(true);
  });

  it('uses catalog exercises only', () => {
    for (const entry of entries) expect(CATALOG_NAMES).toContain(entry.exerciseName);
  });

  it('stays within the API limits and mixes units and bodyweight sets', () => {
    for (const set of sets) {
      expect(Number.isInteger(set.reps) && set.reps! >= 1 && set.reps! <= 1000).toBe(true);
      expect(set.weight! >= 0 && set.weight! <= 5000).toBe(true);
    }
    expect(new Set(sets.map((set) => set.unit))).toEqual(new Set(['kg', 'lb']));
    expect(sets.some((set) => set.weight === 0)).toBe(true);
  });

  it('is deterministic for a given day', () => {
    expect(buildSampleWorkouts('2026-10-16')).toEqual(entries);
  });
});

describe('sampleDataKey', () => {
  it('is a valid Idempotency-Key (visible ASCII, at most 200 characters) per client', () => {
    const key = sampleDataKey('0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
    expect(key).toBe('sample-data-0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
    expect(key).toMatch(/^[\x21-\x7e]{1,200}$/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/sample-data/sample-workouts.test.ts`
Expected: FAIL with `Failed to resolve import "./sample-workouts"`.

- [ ] **Step 3: Implement the generator**

The data is built for the demo. Squats add a heavy single in week 5, so the heaviest set and the best e1RM fall on an earlier day than the volume record. Bench is logged in lb, to show conversion. Pull-ups are bodyweight. With today's date, "this month vs last month" shows one record going up and another going down.

`frontend/src/features/sample-data/sample-workouts.ts`:

```ts
import type { LogEntryInput, WeightUnit } from '../../api/types';
import { addDays } from '../../lib/dates';

/** Days before today of the 16 sample sessions: two a week for eight weeks, the last one today. */
const SESSION_OFFSETS = [52, 49, 45, 42, 38, 35, 31, 28, 24, 21, 17, 14, 10, 7, 3, 0];

type SetSpec = readonly [reps: number, weight: number];

interface Lift {
  exerciseName: string;
  unit: WeightUnit;
  sets: (week: number) => SetSpec[];
}

/** Squat, bench (in lb) and row; week 5 adds a heavy squat single, so the squat records fall on different days. */
const SESSION_A: Lift[] = [
  {
    exerciseName: 'Back Squat',
    unit: 'kg',
    sets: (week) => [
      [5, 100 + 2.5 * week],
      [5, 100 + 2.5 * week],
      [3, 107.5 + 2.5 * week],
      ...(week === 5 ? [[1, 135] as const] : []),
    ],
  },
  {
    exerciseName: 'Bench Press',
    unit: 'lb',
    sets: (week) => [
      [8, 135 + 5 * week],
      [8, 135 + 5 * week],
      [5, 155 + 5 * week],
    ],
  },
  {
    exerciseName: 'Barbell Row',
    unit: 'kg',
    sets: (week) => [
      [10, 60 + 2.5 * week],
      [10, 60 + 2.5 * week],
      [10, 60 + 2.5 * week],
    ],
  },
];

/** Deadlift, overhead press and bodyweight pull-ups. */
const SESSION_B: Lift[] = [
  {
    exerciseName: 'Deadlift',
    unit: 'kg',
    sets: (week) => [
      [5, 140 + 5 * week],
      [3, 150 + 5 * week],
      [1, 165 + 5 * week],
    ],
  },
  {
    exerciseName: 'Overhead Press',
    unit: 'kg',
    sets: (week) => [
      [8, 40 + 1.25 * week],
      [8, 40 + 1.25 * week],
      [6, 42.5 + 1.25 * week],
    ],
  },
  {
    exerciseName: 'Pull-Up',
    unit: 'kg',
    sets: (week) => [
      [10, 0],
      [8 + (week % 3), 0],
      [8, 0],
    ],
  },
];

/** 48 entries of steady progress ending today (the API takes up to 50 per request), in kg and lb. */
export function buildSampleWorkouts(today: string): LogEntryInput[] {
  return SESSION_OFFSETS.flatMap((offset, index) => {
    const week = Math.floor(index / 2);
    const lifts = index % 2 === 0 ? SESSION_A : SESSION_B;
    return lifts.map((lift) => ({
      date: addDays(today, -offset),
      exerciseName: lift.exerciseName,
      sets: lift.sets(week).map(([reps, weight]) => ({ reps, weight, unit: lift.unit })),
    }));
  });
}

/** One key per client: loading sample data twice replays the first load instead of storing it again. */
export function sampleDataKey(userId: string): string {
  return `sample-data-${userId}`;
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npm test -- src/features/sample-data/sample-workouts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing button tests**

`frontend/src/features/sample-data/LoadSampleDataButton.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LogEntryInput } from '../../api/types';
import { USER_ID, makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

describe('LoadSampleDataButton', () => {
  it('loads sample data into an empty account and shows it', async () => {
    let posted: { key: string | null; entries: LogEntryInput[] } | undefined;
    server.use(
      http.post('/api/users/:userId/workout-entries', async ({ request }) => {
        const body = (await request.json()) as { entries: LogEntryInput[] };
        posted = { key: request.headers.get('Idempotency-Key'), entries: body.entries };
        return HttpResponse.json({ data: [] }, { status: 201 });
      }),
      http.get('/api/users/:userId/workout-entries', () =>
        HttpResponse.json(
          posted
            ? {
                data: [makeEntry({ exerciseName: 'Deadlift', date: '2026-10-16' })],
                page: { limit: 20, nextCursor: null },
              }
            : {
                data: [],
                page: { limit: 20, nextCursor: null },
                message: 'No workout entries match the given filters.',
              },
        ),
      ),
    );
    const { user } = renderApp('/history');

    await user.click(await screen.findByRole('button', { name: 'Load sample data' }));

    expect(await screen.findByRole('heading', { name: 'Deadlift' })).toBeInTheDocument();
    expect(posted?.key).toBe(`sample-data-${USER_ID}`);
    expect(posted?.entries).toHaveLength(48);
    expect(posted?.entries.at(-1)?.date).toBe('2026-10-16');
  });

  it('shows why loading failed', async () => {
    server.use(
      http.post('/api/users/:userId/workout-entries', () =>
        HttpResponse.json(
          { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderApp('/history');

    await user.click(await screen.findByRole('button', { name: 'Load sample data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npm test -- src/features/sample-data/LoadSampleDataButton.test.tsx`
Expected: FAIL with `Unable to find role="button" and name "Load sample data"`.

- [ ] **Step 7: Add the button**

`frontend/src/features/sample-data/LoadSampleDataButton.tsx`:

```tsx
import { Loader2, Sparkles } from 'lucide-react';
import { useLogWorkouts } from '../../api/queries';
import { Button, type ButtonSize, type ButtonVariant } from '../../components/ui/Button';
import { todayIsoDay } from '../../lib/dates';
import { useActiveSession } from '../../session/session';
import { buildSampleWorkouts, sampleDataKey } from './sample-workouts';

/** Logs eight weeks of sample workouts for the current client in one request. */
export function LoadSampleDataButton({
  variant = 'secondary',
  size = 'md',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { userId } = useActiveSession();
  const logWorkouts = useLogWorkouts(userId);
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant={variant}
        size={size}
        disabled={logWorkouts.isPending}
        onClick={() =>
          logWorkouts.mutate({
            entries: buildSampleWorkouts(todayIsoDay()),
            idempotencyKey: sampleDataKey(userId),
          })
        }
      >
        {logWorkouts.isPending ? (
          <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        ) : (
          <Sparkles aria-hidden="true" className="size-4" />
        )}
        Load sample data
      </Button>
      {logWorkouts.isError && (
        <p role="alert" className="text-xs text-rose-300">
          {logWorkouts.error.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Offer it in the empty history**

Add the import:

In `frontend/src/features/history/HistoryPage.tsx`, replace:

```tsx
import { useActiveSession } from '../../session/session';
import { EntryCard } from './EntryCard';
```

with:

```tsx
import { useActiveSession } from '../../session/session';
import { LoadSampleDataButton } from '../sample-data/LoadSampleDataButton';
import { EntryCard } from './EntryCard';
```

Then add the button to the "No workouts yet" state:

In `frontend/src/features/history/HistoryPage.tsx`, replace:

```tsx
        description="Log this client's first session to see it here."
      >
        <Link to="/log" className={buttonClass('primary')}>
          <Plus aria-hidden="true" className="size-4" />
          Log workout
        </Link>
      </EmptyState>
```

with:

```tsx
        description="Log this client's first session, or load eight weeks of sample data to explore the app."
      >
        <Link to="/log" className={buttonClass('primary')}>
          <Plus aria-hidden="true" className="size-4" />
          Log workout
        </Link>
        <LoadSampleDataButton />
      </EmptyState>
```

- [ ] **Step 9: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat: load eight weeks of idempotent sample workouts in one click"
```

### Task 7: Personal records screen

**Files:**
- Create: `frontend/src/features/records/metrics.ts`, `frontend/src/features/records/RecordCard.tsx`
- Modify (replace the placeholder): `frontend/src/features/records/RecordsPage.tsx`
- Test: `frontend/src/features/records/RecordsPage.test.tsx`

**Interfaces:**
- Consumes: `useExercises`, `usePersonalRecords`; `useActiveSession`; `PageHeader`, `Alert`, `ApiErrorAlert`, `buttonClass`, `Select`, `Card`, `Skeleton`; `LoadSampleDataButton`; `formatDate`, `formatNumber`, `formatReps`, `formatWeight`.
- Produces: `MetricView { key: RecordMetric; label; icon; glow; badge; dot; describe(record, unit): string }`; `RECORD_METRICS` (in order: `maxWeight` "Heaviest single set" in amber, `maxVolume` "Highest volume set" in sky, `bestE1rm` "Best estimated 1RM" in violet); `RecordCard({ metric, record: PersonalRecord | null, unit })` (`role="group"`, named by its label); `RecordsPage`.

- [ ] **Step 1: Write the failing screen tests**

`frontend/src/features/records/RecordsPage.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Records } from '../../api/types';
import { NO_RECORDS, USER_ID } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const BENCH_RECORDS: Records = {
  maxWeight: { value: 120, weight: 120, reps: 1, date: '2026-09-02', entryId: 'e1' },
  maxVolume: { value: 800, weight: 80, reps: 10, date: '2026-09-02', entryId: 'e1' },
  bestE1rm: { value: 128.33, weight: 110, reps: 5, date: '2026-09-09', entryId: 'e2' },
};

function serveRecords(records: Records) {
  const requests: URL[] = [];
  server.use(
    http.get('/api/users/:userId/personal-records', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json({
        data: {
          exerciseName: url.searchParams.get('exerciseName'),
          unit: url.searchParams.get('unit'),
          from: null,
          to: null,
          records,
        },
      });
    }),
  );
  return requests;
}

describe('RecordsPage', () => {
  it('shows the three records of the first catalog exercise, with how and when each was set', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    renderApp('/records');

    const heaviest = await screen.findByRole('group', { name: 'Heaviest single set' });
    expect(heaviest).toHaveTextContent('120kg');
    expect(heaviest).toHaveTextContent('1 rep × 120 kg');
    expect(heaviest).toHaveTextContent('Achieved Sep 2, 2026');

    const volume = screen.getByRole('group', { name: 'Highest volume set' });
    expect(volume).toHaveTextContent('800kg');
    expect(volume).toHaveTextContent('10 reps × 80 kg');

    const e1rm = screen.getByRole('group', { name: 'Best estimated 1RM' });
    expect(e1rm).toHaveTextContent('128.33kg');
    expect(e1rm).toHaveTextContent('Epley, from 5 reps × 110 kg');
    expect(e1rm).toHaveTextContent('Achieved Sep 9, 2026');

    expect(screen.getByLabelText('Exercise')).toHaveValue('Back Squat');
    expect(requests[0]?.pathname).toBe(`/api/users/${USER_ID}/personal-records`);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Back Squat',
      unit: 'kg',
    });
  });

  it('switches exercise from the picker', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    const { user } = renderApp('/records');
    await screen.findByRole('group', { name: 'Heaviest single set' });

    await user.selectOptions(screen.getByLabelText('Exercise'), 'Deadlift');

    await waitFor(() => expect(requests.at(-1)?.searchParams.get('exerciseName')).toBe('Deadlift'));
    expect(screen.getByLabelText('Exercise')).toHaveValue('Deadlift');
  });

  it('reads the exercise from the URL and requests the display unit', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    renderApp('/records?exercise=Bench%20Press', { unit: 'lb' });

    expect(await screen.findByRole('group', { name: 'Heaviest single set' })).toHaveTextContent('120lb');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Bench Press',
      unit: 'lb',
    });
  });

  it('explains when there are no records yet and offers sample data', async () => {
    renderApp('/records?exercise=Deadlift');

    expect(await screen.findByText('No Deadlift entries found for this user.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load sample data' })).toBeInTheDocument();
    for (const name of ['Heaviest single set', 'Highest volume set', 'Best estimated 1RM']) {
      expect(screen.getByRole('group', { name })).toHaveTextContent('No sets logged yet');
    }
  });

  it('shows a record of bodyweight work without a weight', async () => {
    serveRecords({
      ...NO_RECORDS,
      maxVolume: { value: 0, weight: 0, reps: 12, date: '2026-10-01', entryId: 'e3' },
    });
    renderApp('/records?exercise=Pull-Up');

    expect(await screen.findByRole('group', { name: 'Highest volume set' })).toHaveTextContent(
      '12 reps at bodyweight',
    );
  });

  it('shows the API error for an exercise outside the catalog', async () => {
    server.use(
      http.get('/api/users/:userId/personal-records', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            errors: [{ field: 'exerciseName', message: 'Unknown exercise "Curl"' }],
          },
          { status: 400 },
        ),
      ),
    );
    renderApp('/records?exercise=Curl');

    expect(await screen.findByRole('alert')).toHaveTextContent('exerciseName: Unknown exercise "Curl"');
    expect(screen.queryByRole('group', { name: 'Heaviest single set' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Compare periods' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/records/RecordsPage.test.tsx`
Expected: FAIL with `Unable to find role="group" and name "Heaviest single set"`.

- [ ] **Step 3: Add the metric definitions and the card**

`frontend/src/features/records/metrics.ts`:

```ts
import { Layers, type LucideIcon, Weight, Zap } from 'lucide-react';
import type { PersonalRecord, RecordMetric, WeightUnit } from '../../api/types';
import { formatReps, formatWeight } from '../../lib/format';

export interface MetricView {
  key: RecordMetric;
  label: string;
  icon: LucideIcon;
  /** Complete class strings (Tailwind only generates classes it finds written out in full). */
  glow: string;
  badge: string;
  dot: string;
  /** How the record was set, e.g. "1 rep × 120 kg". */
  describe: (record: PersonalRecord, unit: WeightUnit) => string;
}

const setOf = (record: PersonalRecord, unit: WeightUnit) =>
  record.weight === 0
    ? `${formatReps(record.reps)} at bodyweight`
    : `${formatReps(record.reps)} × ${formatWeight(record.weight, unit)}`;

export const RECORD_METRICS: readonly MetricView[] = [
  {
    key: 'maxWeight',
    label: 'Heaviest single set',
    icon: Weight,
    glow: 'from-amber-400/15',
    badge: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
    dot: 'bg-amber-300',
    describe: setOf,
  },
  {
    key: 'maxVolume',
    label: 'Highest volume set',
    icon: Layers,
    glow: 'from-sky-400/15',
    badge: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
    dot: 'bg-sky-300',
    describe: setOf,
  },
  {
    key: 'bestE1rm',
    label: 'Best estimated 1RM',
    icon: Zap,
    glow: 'from-violet-400/15',
    badge: 'bg-violet-400/10 text-violet-300 ring-violet-400/25',
    dot: 'bg-violet-300',
    describe: (record, unit) => `Epley, from ${setOf(record, unit)}`,
  },
];
```

`frontend/src/features/records/RecordCard.tsx`:

```tsx
import { clsx } from 'clsx';
import { CalendarDays } from 'lucide-react';
import { useId } from 'react';
import type { PersonalRecord, WeightUnit } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import type { MetricView } from './metrics';

export function RecordCard({
  metric,
  record,
  unit,
}: {
  metric: MetricView;
  record: PersonalRecord | null;
  unit: WeightUnit;
}) {
  const titleId = useId();
  const Icon = metric.icon;
  return (
    <Card role="group" aria-labelledby={titleId} className="relative overflow-hidden p-5">
      <div
        aria-hidden="true"
        className={clsx('pointer-events-none absolute inset-0 bg-linear-to-br to-transparent', metric.glow)}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className={clsx('grid size-10 place-items-center rounded-xl ring-1', metric.badge)}>
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <h3 id={titleId} className="text-sm font-medium text-zinc-300">
            {metric.label}
          </h3>
        </div>
        {record ? (
          <>
            <p className="mt-6 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
              {formatNumber(record.value)}
              <span className="ml-1.5 text-lg font-medium text-zinc-400">{unit}</span>
            </p>
            <p className="mt-2 text-sm text-zinc-400">{metric.describe(record, unit)}</p>
            <p className="mt-5 flex items-center gap-1.5 text-xs text-zinc-500">
              <CalendarDays aria-hidden="true" className="size-3.5" />
              Achieved <time dateTime={record.date}>{formatDate(record.date)}</time>
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 text-4xl font-bold text-zinc-700">—</p>
            <p className="mt-2 text-sm text-zinc-500">No sets logged yet</p>
          </>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Replace the placeholder page**

Replace the whole of `frontend/src/features/records/RecordsPage.tsx` with:

`frontend/src/features/records/RecordsPage.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useExercises, usePersonalRecords } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { buttonClass } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Skeleton';
import { useActiveSession } from '../../session/session';
import { LoadSampleDataButton } from '../sample-data/LoadSampleDataButton';
import { RECORD_METRICS } from './metrics';
import { RecordCard } from './RecordCard';

export function RecordsPage() {
  const { userId, unit } = useActiveSession();
  const [params, setParams] = useSearchParams();
  const exercises = useExercises();
  // The exercise is kept in the URL (?exercise=Deadlift); the first catalog exercise is the default.
  const exerciseName = params.get('exercise') ?? exercises.data?.[0]?.name ?? '';
  const records = usePersonalRecords(userId, exerciseName, unit);

  return (
    <>
      <PageHeader
        title="Personal records"
        description="All-time bests for one exercise, with the day each was set."
        actions={
          <Select
            label="Exercise"
            className="w-full sm:w-64"
            value={exerciseName}
            onChange={(event) => setParams({ exercise: event.target.value }, { replace: true })}
            disabled={!exercises.data}
          >
            {exercises.data?.map((exercise) => (
              <option key={exercise.name} value={exercise.name}>
                {exercise.name}
              </option>
            ))}
          </Select>
        }
      />
      {exercises.isError && <ApiErrorAlert error={exercises.error} className="mb-6" />}
      {records.isError && <ApiErrorAlert error={records.error} className="mb-6" />}
      {records.data?.message && (
        <Alert tone="info" title={records.data.message} className="mb-6">
          <p>Log a workout or load sample data to see records here.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/log" className={buttonClass('secondary', 'sm')}>
              <Plus aria-hidden="true" className="size-4" />
              Log workout
            </Link>
            <LoadSampleDataButton size="sm" />
          </div>
        </Alert>
      )}
      {!records.isError && (
        <div className="grid gap-4 md:grid-cols-3">
          {RECORD_METRICS.map((metric) =>
            records.data ? (
              <RecordCard
                key={metric.key}
                metric={metric}
                record={records.data.data.records[metric.key]}
                unit={unit}
              />
            ) : (
              <Skeleton key={metric.key} className="h-52 rounded-2xl" />
            ),
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat: show personal records with the set and date behind each"
```

### Task 8: Period comparison

**Files:**
- Create: `frontend/src/features/records/ComparisonPanel.tsx`
- Modify: `frontend/src/features/records/RecordsPage.tsx`
- Test: `frontend/src/features/records/ComparisonPanel.test.tsx`

**Interfaces:**
- Consumes: `useComparison`; `comparisonPeriods`, `PERIOD_PRESETS`, `PeriodPreset`, `formatDate`, `formatDayRange`, `todayIsoDay`; `formatSignedPercent`, `formatSignedWeight`, `formatWeight`; `RECORD_METRICS`; `Card`, `SegmentedControl`, `Skeleton`, `ApiErrorAlert`.
- Produces: `ComparisonPanel({ exerciseName })`, which defaults to Month and keeps the period choice in local state.

- [ ] **Step 1: Write the failing comparison tests**

`frontend/src/features/records/ComparisonPanel.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

describe('ComparisonPanel', () => {
  function serveComparison() {
    const requests: URL[] = [];
    server.use(
      http.get('/api/users/:userId/personal-records/comparison', ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const q = url.searchParams;
        return HttpResponse.json({
          data: {
            exerciseName: q.get('exerciseName'),
            unit: q.get('unit'),
            current: {
              from: q.get('from'),
              to: q.get('to'),
              records: {
                maxWeight: { value: 110, weight: 110, reps: 3, date: '2026-10-07', entryId: 'c1' },
                maxVolume: { value: 330, weight: 110, reps: 3, date: '2026-10-07', entryId: 'c1' },
                bestE1rm: null,
              },
            },
            baseline: {
              from: q.get('baselineFrom'),
              to: q.get('baselineTo'),
              records: {
                maxWeight: { value: 105, weight: 105, reps: 1, date: '2026-09-20', entryId: 'b1' },
                maxVolume: { value: 500, weight: 100, reps: 5, date: '2026-09-12', entryId: 'b2' },
                bestE1rm: { value: 116.67, weight: 100, reps: 5, date: '2026-09-12', entryId: 'b2' },
              },
            },
            change: {
              maxWeight: { absolute: 5, percent: 4.76 },
              maxVolume: { absolute: -170, percent: -34 },
              bestE1rm: null,
            },
          },
        });
      }),
    );
    return requests;
  }

  it('compares this month so far with last month by default', async () => {
    const requests = serveComparison();
    renderApp('/records?exercise=Bench%20Press');

    const table = await screen.findByRole('table');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Bench Press',
      unit: 'kg',
      from: '2026-10-01',
      to: '2026-10-16',
      baselineFrom: '2026-09-01',
      baselineTo: '2026-09-30',
    });
    expect(within(table).getByRole('columnheader', { name: /Last month/ })).toHaveTextContent(
      'Sep 1 – Sep 30, 2026',
    );
    expect(within(table).getByRole('columnheader', { name: /This month/ })).toHaveTextContent(
      'Oct 1 – Oct 16, 2026',
    );

    const heaviest = within(table).getByRole('row', { name: /Heaviest single set/ });
    expect(heaviest).toHaveTextContent('105 kg');
    expect(heaviest).toHaveTextContent('110 kg');
    expect(heaviest).toHaveTextContent('+5 kg · +4.76%');
    expect(within(table).getByRole('row', { name: /Highest volume set/ })).toHaveTextContent(
      '-170 kg · -34%',
    );
    // No current record, so no change either.
    const e1rm = within(within(table).getByRole('row', { name: /Best estimated 1RM/ })).getAllByRole('cell');
    expect(e1rm.map((cell) => cell.textContent)).toEqual(['116.67 kgSep 12, 2026', '—', '—']);
  });

  it('switches to week-over-week, with weeks starting on Monday', async () => {
    const requests = serveComparison();
    const { user } = renderApp('/records?exercise=Bench%20Press');
    await screen.findByRole('table');

    await user.click(screen.getByRole('radio', { name: 'Week' }));

    await waitFor(() =>
      expect(Object.fromEntries(requests.at(-1)?.searchParams ?? [])).toMatchObject({
        from: '2026-10-12',
        to: '2026-10-16',
        baselineFrom: '2026-10-05',
        baselineTo: '2026-10-11',
      }),
    );
    expect(await screen.findByRole('columnheader', { name: /This week/ })).toBeInTheDocument();
  });

  it('shows the API message when neither period has data', async () => {
    renderApp('/records?exercise=Deadlift');

    expect(
      await screen.findByText('No Deadlift entries found for this user in either date range.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/records/ComparisonPanel.test.tsx`
Expected: FAIL with `Unable to find role="table"`.

- [ ] **Step 3: Add the panel**

`frontend/src/features/records/ComparisonPanel.tsx`:

```tsx
import { clsx } from 'clsx';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type { MetricChange, PersonalRecord, WeightUnit } from '../../api/types';
import { useComparison } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  PERIOD_PRESETS,
  type PeriodPreset,
  comparisonPeriods,
  formatDate,
  formatDayRange,
  todayIsoDay,
} from '../../lib/dates';
import { formatSignedPercent, formatSignedWeight, formatWeight } from '../../lib/format';
import { useActiveSession } from '../../session/session';
import { RECORD_METRICS } from './metrics';

/** Records in the current period so far against the whole previous one, e.g. this month vs last month. */
export function ComparisonPanel({ exerciseName }: { exerciseName: string }) {
  const { userId, unit } = useActiveSession();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const periods = comparisonPeriods(preset, todayIsoDay());
  const comparison = useComparison(userId, {
    exerciseName,
    unit,
    current: periods.current,
    baseline: periods.baseline,
  });

  let body;
  if (comparison.isPending) {
    body = <Skeleton className="h-40 rounded-xl" />;
  } else if (comparison.isError) {
    body = <ApiErrorAlert error={comparison.error} />;
  } else if (comparison.data.message) {
    body = (
      <p className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-zinc-400">
        {comparison.data.message}
      </p>
    );
  } else {
    const { current, baseline, change } = comparison.data.data;
    body = (
      <div
        className={clsx(
          '-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6',
          comparison.isPlaceholderData && 'opacity-60',
        )}
      >
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
              <th scope="col" className="pb-3 font-medium">
                Record
              </th>
              <PeriodHeading label={periods.baselineLabel} from={baseline.from} to={baseline.to} />
              <PeriodHeading label={periods.currentLabel} from={current.from} to={current.to} />
              <th scope="col" className="pb-3 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {RECORD_METRICS.map((metric) => (
              <tr key={metric.key}>
                <th scope="row" className="py-3.5 pr-4 text-left font-medium text-zinc-200">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={clsx('size-2 rounded-full', metric.dot)} />
                    {metric.label}
                  </span>
                </th>
                <RecordCell record={baseline.records[metric.key]} unit={unit} />
                <RecordCell record={current.records[metric.key]} unit={unit} />
                <td className="py-3.5 text-right">
                  <ChangeBadge change={change[metric.key]} unit={unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card className="mt-8 p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Compare periods</h2>
          <p className="text-sm text-zinc-400">
            {periods.currentLabel} so far against all of {periods.baselineLabel.toLowerCase()}.
          </p>
        </div>
        <SegmentedControl
          label="Comparison period"
          options={PERIOD_PRESETS}
          value={preset}
          onChange={setPreset}
        />
      </div>
      {body}
    </Card>
  );
}

function PeriodHeading({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <th scope="col" className="pr-4 pb-3 font-medium">
      {label}
      <span className="block font-normal tracking-normal text-zinc-600 normal-case">
        {formatDayRange(from, to)}
      </span>
    </th>
  );
}

function RecordCell({ record, unit }: { record: PersonalRecord | null; unit: WeightUnit }) {
  if (record === null) return <td className="py-3.5 pr-4 text-zinc-600">—</td>;
  return (
    <td className="py-3.5 pr-4">
      <span className="font-semibold text-zinc-100 tabular-nums">{formatWeight(record.value, unit)}</span>
      <span className="block text-xs text-zinc-500">{formatDate(record.date)}</span>
    </td>
  );
}

const CHANGE_TONES = {
  up: { icon: TrendingUp, className: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20' },
  down: { icon: TrendingDown, className: 'bg-rose-400/10 text-rose-300 ring-rose-400/20' },
  flat: { icon: Minus, className: 'bg-white/5 text-zinc-400 ring-white/10' },
} as const;

function ChangeBadge({ change, unit }: { change: MetricChange | null; unit: WeightUnit }) {
  if (change === null) {
    return (
      <span className="text-zinc-600" title="Needs a record in both periods">
        —
      </span>
    );
  }
  const tone = change.absolute > 0 ? 'up' : change.absolute < 0 ? 'down' : 'flat';
  const { icon: Icon, className } = CHANGE_TONES[tone];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ring-1',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {formatSignedWeight(change.absolute, unit)}
      {change.percent !== null && ` · ${formatSignedPercent(change.percent)}`}
    </span>
  );
}
```

- [ ] **Step 4: Show it under the record cards**

Add the import:

In `frontend/src/features/records/RecordsPage.tsx`, replace:

```tsx
import { LoadSampleDataButton } from '../sample-data/LoadSampleDataButton';
import { RECORD_METRICS } from './metrics';
```

with:

```tsx
import { LoadSampleDataButton } from '../sample-data/LoadSampleDataButton';
import { ComparisonPanel } from './ComparisonPanel';
import { RECORD_METRICS } from './metrics';
```

Then render the panel after the cards. It stays hidden when the records request failed, so the same error is not shown twice:

In `frontend/src/features/records/RecordsPage.tsx`, replace:

```tsx
      {!records.isError && (
        <div className="grid gap-4 md:grid-cols-3">
          {RECORD_METRICS.map((metric) =>
            records.data ? (
              <RecordCard
                key={metric.key}
                metric={metric}
                record={records.data.data.records[metric.key]}
                unit={unit}
              />
            ) : (
              <Skeleton key={metric.key} className="h-52 rounded-2xl" />
            ),
          )}
        </div>
      )}
```

with:

```tsx
      {!records.isError && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {RECORD_METRICS.map((metric) =>
              records.data ? (
                <RecordCard
                  key={metric.key}
                  metric={metric}
                  record={records.data.data.records[metric.key]}
                  unit={unit}
                />
              ) : (
                <Skeleton key={metric.key} className="h-52 rounded-2xl" />
              ),
            )}
          </div>
          {exerciseName !== '' && <ComparisonPanel exerciseName={exerciseName} />}
        </>
      )}
```

- [ ] **Step 5: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat: compare records this week, month or year against the previous one"
```

### Task 9: Log workout screen

**Files:**
- Create: `frontend/src/lib/field-errors.ts`, `frontend/src/features/log/log-form.ts`, `frontend/src/features/log/EntryFields.tsx`
- Modify (replace the placeholder): `frontend/src/features/log/LogWorkoutPage.tsx`
- Test: `frontend/src/features/log/log-form.test.ts`, `frontend/src/features/log/LogWorkoutPage.test.tsx`

**Interfaces:**
- Consumes: `ApiError`; `useExercises`, `useLogWorkouts`; `useActiveSession`; `todayIsoDay`; `HistoryLocationState`; `PageHeader`, `ApiErrorAlert`, `Button`, `Card`, `Input`, `Select`; `WEIGHT_UNITS`.
- Produces: `fieldErrorMap(errors: readonly FieldError[]): Map<string, string>` (the first message per field path).
- Produces, in `log-form.ts`: `MAX_ENTRIES` and `MAX_SETS` (50 each, the API's limits), `SetDraft { key; reps: string; weight: string; unit }`, `EntryDraft { key; exerciseName; sets }`, `LogFormState { date; entries }`, `LogFormAction` (`setDate`, `addEntry`, `removeEntry`, `setExercise`, `addSet`, `removeSet`, `updateSet`), `initialLogForm(today, unit)`, `logFormReducer(state, action)`, `toLogEntries(state): LogEntryInput[]`, `setCount(state): number`.
- Produces: `EntryFields({ index, entry, exercises, errors, canRemove, dispatch })` (`role="group"` named `Exercise <n>`), `LogWorkoutPage`.

- [ ] **Step 1: Write the failing reducer tests**

`frontend/src/features/log/log-form.test.ts`:

```ts
import {
  type LogFormState,
  MAX_SETS,
  initialLogForm,
  logFormReducer,
  setCount,
  toLogEntries,
} from './log-form';

function entryKey(state: LogFormState, index = 0) {
  return state.entries[index]!.key;
}

function setKey(state: LogFormState, entryIndex = 0, setIndex = 0) {
  return state.entries[entryIndex]!.sets[setIndex]!.key;
}

describe('logFormReducer', () => {
  it('starts with one empty entry on the given day in the given unit', () => {
    const state = initialLogForm('2026-10-16', 'lb');
    expect(state).toEqual({
      date: '2026-10-16',
      entries: [
        {
          key: expect.any(String),
          exerciseName: '',
          sets: [{ key: expect.any(String), reps: '', weight: '', unit: 'lb' }],
        },
      ],
    });
  });

  it('adds a set that repeats the previous one, with a new key', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, {
      type: 'updateSet',
      entryKey: entryKey(state),
      setKey: setKey(state),
      patch: { reps: '5', weight: '100' },
    });
    state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });

    const [first, second] = state.entries[0]!.sets;
    expect(second).toMatchObject({ reps: '5', weight: '100', unit: 'kg' });
    expect(second!.key).not.toBe(first!.key);
  });

  it('stops adding sets at the API limit', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    for (let i = 0; i < MAX_SETS + 5; i++)
      state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });
    expect(state.entries[0]!.sets).toHaveLength(MAX_SETS);
  });

  it('never removes the last entry or the last set', () => {
    const state = initialLogForm('2026-10-16', 'kg');
    expect(logFormReducer(state, { type: 'removeEntry', entryKey: entryKey(state) })).toBe(state);
    expect(
      logFormReducer(state, { type: 'removeSet', entryKey: entryKey(state), setKey: setKey(state) })
        .entries[0]!.sets,
    ).toHaveLength(1);
  });

  it('adds and removes entries', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, { type: 'addEntry', unit: 'lb' });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]!.sets[0]!.unit).toBe('lb');

    state = logFormReducer(state, { type: 'removeEntry', entryKey: entryKey(state, 0) });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.sets[0]!.unit).toBe('lb');
  });
});

describe('toLogEntries', () => {
  it('builds the request entries with the session date and numbers', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, {
      type: 'setExercise',
      entryKey: entryKey(state),
      exerciseName: 'Bench Press',
    });
    state = logFormReducer(state, {
      type: 'updateSet',
      entryKey: entryKey(state),
      setKey: setKey(state),
      patch: { reps: '5', weight: '102.5' },
    });

    expect(toLogEntries(state)).toEqual([
      { date: '2026-10-16', exerciseName: 'Bench Press', sets: [{ reps: 5, weight: 102.5, unit: 'kg' }] },
    ]);
  });

  it('sends blank numbers as null and leaves the exercise empty, for the API to report', () => {
    const state = initialLogForm('2026-10-16', 'kg');
    expect(toLogEntries(state)).toEqual([
      { date: '2026-10-16', exerciseName: '', sets: [{ reps: null, weight: null, unit: 'kg' }] },
    ]);
  });

  it('counts sets across entries', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });
    state = logFormReducer(state, { type: 'addEntry', unit: 'kg' });
    expect(setCount(state)).toBe(3);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test -- src/features/log/log-form.test.ts`
Expected: FAIL with `Failed to resolve import "./log-form"`.

- [ ] **Step 3: Implement the form state**

`frontend/src/features/log/log-form.ts`:

```ts
import type { LogEntryInput, WeightUnit } from '../../api/types';

/** The API accepts at most 50 entries per request and 50 sets per entry. */
export const MAX_ENTRIES = 50;
export const MAX_SETS = 50;

// Number fields stay strings while editing, so a cleared field is '' rather than 0.
export interface SetDraft {
  key: string;
  reps: string;
  weight: string;
  unit: WeightUnit;
}

export interface EntryDraft {
  key: string;
  exerciseName: string;
  sets: SetDraft[];
}

/** One session: a single date shared by every entry. */
export interface LogFormState {
  date: string;
  entries: EntryDraft[];
}

export type LogFormAction =
  | { type: 'setDate'; date: string }
  | { type: 'addEntry'; unit: WeightUnit }
  | { type: 'removeEntry'; entryKey: string }
  | { type: 'setExercise'; entryKey: string; exerciseName: string }
  | { type: 'addSet'; entryKey: string }
  | { type: 'removeSet'; entryKey: string; setKey: string }
  | { type: 'updateSet'; entryKey: string; setKey: string; patch: Partial<Omit<SetDraft, 'key'>> };

let lastKey = 0;
const nextKey = () => `draft-${++lastKey}`;

const emptySet = (unit: WeightUnit): SetDraft => ({ key: nextKey(), reps: '', weight: '', unit });
const emptyEntry = (unit: WeightUnit): EntryDraft => ({
  key: nextKey(),
  exerciseName: '',
  sets: [emptySet(unit)],
});

export function initialLogForm(today: string, unit: WeightUnit): LogFormState {
  return { date: today, entries: [emptyEntry(unit)] };
}

export function logFormReducer(state: LogFormState, action: LogFormAction): LogFormState {
  switch (action.type) {
    case 'setDate':
      return { ...state, date: action.date };
    case 'addEntry':
      return state.entries.length >= MAX_ENTRIES
        ? state
        : { ...state, entries: [...state.entries, emptyEntry(action.unit)] };
    case 'removeEntry':
      return state.entries.length === 1
        ? state
        : { ...state, entries: state.entries.filter((entry) => entry.key !== action.entryKey) };
    case 'setExercise':
      return updateEntry(state, action.entryKey, (entry) => ({
        ...entry,
        exerciseName: action.exerciseName,
      }));
    case 'addSet':
      // A new set repeats the previous one: most sessions repeat the same reps and weight.
      return updateEntry(state, action.entryKey, (entry) => {
        const last = entry.sets.at(-1);
        if (last === undefined || entry.sets.length >= MAX_SETS) return entry;
        return { ...entry, sets: [...entry.sets, { ...last, key: nextKey() }] };
      });
    case 'removeSet':
      return updateEntry(state, action.entryKey, (entry) =>
        entry.sets.length === 1
          ? entry
          : { ...entry, sets: entry.sets.filter((set) => set.key !== action.setKey) },
      );
    case 'updateSet':
      return updateEntry(state, action.entryKey, (entry) => ({
        ...entry,
        sets: entry.sets.map((set) => (set.key === action.setKey ? { ...set, ...action.patch } : set)),
      }));
  }
}

function updateEntry(
  state: LogFormState,
  entryKey: string,
  update: (entry: EntryDraft) => EntryDraft,
): LogFormState {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.key === entryKey ? update(entry) : entry)),
  };
}

/**
 * The request body's entries. Nothing is validated here: blank numbers become null and an unchosen
 * exercise stays '', so the API reports every problem with its field path (one source of rules).
 */
export function toLogEntries(state: LogFormState): LogEntryInput[] {
  return state.entries.map((entry) => ({
    date: state.date,
    exerciseName: entry.exerciseName,
    sets: entry.sets.map((set) => ({
      reps: toNumber(set.reps),
      weight: toNumber(set.weight),
      unit: set.unit,
    })),
  }));
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function setCount(state: LogFormState): number {
  return state.entries.reduce((total, entry) => total + entry.sets.length, 0);
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npm test -- src/features/log/log-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing screen tests**

`frontend/src/features/log/LogWorkoutPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LogEntryInput } from '../../api/types';
import { makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

interface Posted {
  key: string | null;
  body: { entries: LogEntryInput[] };
}

function captureLogs(
  respond: (posted: Posted) => Response = () =>
    HttpResponse.json({ data: [makeEntry(), makeEntry()] }, { status: 201 }),
) {
  const posts: Posted[] = [];
  server.use(
    http.post('/api/users/:userId/workout-entries', async ({ request }) => {
      const posted = {
        key: request.headers.get('Idempotency-Key'),
        body: (await request.json()) as Posted['body'],
      };
      posts.push(posted);
      return respond(posted);
    }),
  );
  return posts;
}

const exercise = (number: number) => screen.getByRole('group', { name: `Exercise ${number}` });

describe('LogWorkoutPage', () => {
  it('logs a session of several exercises and returns to the history with a confirmation', async () => {
    const posts = captureLogs();
    const { user } = renderApp('/log');
    await screen.findByRole('option', { name: 'Bench Press' });

    const first = exercise(1);
    await user.selectOptions(within(first).getByLabelText('Exercise'), 'Bench Press');
    await user.type(within(first).getByLabelText('Set 1 reps'), '5');
    await user.type(within(first).getByLabelText('Set 1 weight'), '100');
    await user.click(within(first).getByRole('button', { name: 'Add set' }));
    await user.clear(within(first).getByLabelText('Set 2 weight'));
    await user.type(within(first).getByLabelText('Set 2 weight'), '102.5');

    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    const second = exercise(2);
    await user.selectOptions(within(second).getByLabelText('Exercise'), 'Back Squat');
    await user.type(within(second).getByLabelText('Set 1 reps'), '5');
    await user.type(within(second).getByLabelText('Set 1 weight'), '225');
    await user.selectOptions(within(second).getByLabelText('Set 1 unit'), 'lb');

    expect(screen.getByText('2 exercises · 3 sets')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved 2 exercises.');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[0]?.body).toEqual({
      entries: [
        {
          date: '2026-10-16',
          exerciseName: 'Bench Press',
          sets: [
            { reps: 5, weight: 100, unit: 'kg' },
            { reps: 5, weight: 102.5, unit: 'kg' },
          ],
        },
        { date: '2026-10-16', exerciseName: 'Back Squat', sets: [{ reps: 5, weight: 225, unit: 'lb' }] },
      ],
    });
  });

  it('defaults new sets to the display unit', async () => {
    renderApp('/log', { unit: 'lb' });

    expect(within(exercise(1)).getByLabelText('Set 1 unit')).toHaveValue('lb');
  });

  it('shows API validation errors next to their fields and clears them on edit', async () => {
    captureLogs(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          errors: [
            { field: 'entries[0].exerciseName', message: 'exerciseName must not be empty' },
            { field: 'entries[0].sets[0].reps', message: 'reps is required' },
            {
              field: 'entries[0].date',
              message: 'date must not be after 2026-10-17 (more than one day in the future)',
            },
          ],
          requestId: 'req-7',
        },
        { status: 400 },
      ),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Request validation failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Request ID req-7');
    expect(within(exercise(1)).getByText('exerciseName must not be empty')).toBeInTheDocument();
    expect(within(exercise(1)).getByLabelText('Set 1 reps')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Session date')).toHaveAccessibleDescription(
      'date must not be after 2026-10-17 (more than one day in the future)',
    );

    await user.type(within(exercise(1)).getByLabelText('Set 1 reps'), '5');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(exercise(1)).queryByText('exerciseName must not be empty')).not.toBeInTheDocument();
  });

  it('reuses the Idempotency-Key when retrying after a network failure', async () => {
    let attempt = 0;
    const posts = captureLogs(() =>
      ++attempt === 1 ? HttpResponse.error() : HttpResponse.json({ data: [makeEntry()] }, { status: 201 }),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the API');
    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).toBe(posts[0]?.key);
  });

  it('sends one key however often Save is clicked, so the API stores the session once', async () => {
    const posts = captureLogs();
    const { user } = renderApp('/log');

    await user.dblClick(screen.getByRole('button', { name: 'Save workout' }));

    await screen.findByRole('heading', { name: 'Workout history' });
    expect(new Set(posts.map((post) => post.key)).size).toBe(1);
  });

  it('tells the coach when the API had already stored this workout', async () => {
    captureLogs(() =>
      HttpResponse.json({ data: [makeEntry()] }, { status: 201, headers: { 'Idempotent-Replayed': 'true' } }),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('status')).toHaveTextContent('This workout was already saved.');
  });

  it('removes sets and exercises but always keeps one of each', async () => {
    const { user } = renderApp('/log');

    expect(within(exercise(1)).getByRole('button', { name: 'Remove set 1' })).toBeDisabled();
    expect(within(exercise(1)).getByRole('button', { name: 'Remove exercise 1' })).toBeDisabled();

    await user.click(within(exercise(1)).getByRole('button', { name: 'Add set' }));
    await user.click(within(exercise(1)).getByRole('button', { name: 'Remove set 2' }));
    expect(within(exercise(1)).queryByLabelText('Set 2 reps')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    await user.click(within(exercise(2)).getByRole('button', { name: 'Remove exercise 2' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Exercise 2' })).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npm test -- src/features/log/LogWorkoutPage.test.tsx`
Expected: FAIL. The placeholder has no form, so you get errors such as `Unable to find role="option" and name "Bench Press"` and `Unable to find role="group" and name "Exercise 1"`.

- [ ] **Step 7: Add the field error map and the entry fields**

`frontend/src/lib/field-errors.ts`:

```ts
import type { FieldError } from '../api/types';

/** API field errors by path (`entries[0].sets[1].weight`), keeping the first message for each field. */
export function fieldErrorMap(errors: readonly FieldError[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const error of errors) {
    if (!map.has(error.field)) map.set(error.field, error.message);
  }
  return map;
}
```

`frontend/src/features/log/EntryFields.tsx`:

```tsx
import { Plus, Trash2, X } from 'lucide-react';
import type { Exercise } from '../../api/types';
import { WEIGHT_UNITS } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Field';
import { type EntryDraft, type LogFormAction, MAX_SETS } from './log-form';

interface EntryFieldsProps {
  index: number;
  entry: EntryDraft;
  exercises: readonly Exercise[];
  /** API field errors by path, e.g. `entries[0].sets[1].weight`. */
  errors: ReadonlyMap<string, string>;
  canRemove: boolean;
  dispatch: (action: LogFormAction) => void;
}

/** One exercise of the session and its sets. */
export function EntryFields({ index, entry, exercises, errors, canRemove, dispatch }: EntryFieldsProps) {
  const number = index + 1;
  const path = `entries[${index}]`;
  const setsError = errors.get(`${path}.sets`);
  return (
    <Card role="group" aria-label={`Exercise ${number}`} className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-[1.375rem] grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-sm font-semibold text-zinc-400 tabular-nums">
          {number}
        </span>
        <Select
          label="Exercise"
          className="flex-1"
          value={entry.exerciseName}
          onChange={(event) =>
            dispatch({ type: 'setExercise', entryKey: entry.key, exerciseName: event.target.value })
          }
          error={errors.get(`${path}.exerciseName`)}
        >
          <option value="">Choose an exercise</option>
          {exercises.map((exercise) => (
            <option key={exercise.name} value={exercise.name}>
              {exercise.name}
            </option>
          ))}
        </Select>
        <Button
          variant="danger"
          className="mt-[1.375rem] w-10 px-0"
          aria-label={`Remove exercise ${number}`}
          disabled={!canRemove}
          onClick={() => dispatch({ type: 'removeEntry', entryKey: entry.key })}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
            <th scope="col" className="w-10 pb-2 font-medium">
              Set
            </th>
            <th scope="col" className="pr-2 pb-2 font-medium">
              Reps
            </th>
            <th scope="col" className="pr-2 pb-2 font-medium">
              Weight
            </th>
            <th scope="col" className="w-20 pr-2 pb-2 font-medium">
              Unit
            </th>
            <th scope="col" className="w-10 pb-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.sets.map((set, setIndex) => {
            const setPath = `${path}.sets[${setIndex}]`;
            const setNumber = setIndex + 1;
            const update = (patch: Partial<Omit<typeof set, 'key'>>) =>
              dispatch({ type: 'updateSet', entryKey: entry.key, setKey: set.key, patch });
            return (
              <tr key={set.key} className="align-top">
                <td className="py-1.5 leading-10 text-zinc-500 tabular-nums">{setNumber}</td>
                <td className="py-1.5 pr-2">
                  <Input
                    label={`Set ${setNumber} reps`}
                    hideLabel
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={set.reps}
                    onChange={(event) => update({ reps: event.target.value })}
                    error={errors.get(`${setPath}.reps`)}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    label={`Set ${setNumber} weight`}
                    hideLabel
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={set.weight}
                    onChange={(event) => update({ weight: event.target.value })}
                    error={errors.get(`${setPath}.weight`)}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Select
                    label={`Set ${setNumber} unit`}
                    hideLabel
                    value={set.unit}
                    onChange={(event) => update({ unit: event.target.value as typeof set.unit })}
                    error={errors.get(`${setPath}.unit`)}
                  >
                    {WEIGHT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1.5">
                  <Button
                    variant="danger"
                    className="w-10 px-0"
                    aria-label={`Remove set ${setNumber}`}
                    disabled={entry.sets.length === 1}
                    onClick={() => dispatch({ type: 'removeSet', entryKey: entry.key, setKey: set.key })}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {setsError && <p className="mt-2 text-xs text-rose-300">{setsError}</p>}
      <p className="mt-2 text-xs text-zinc-500">Enter 0 as the weight for bodyweight sets.</p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        disabled={entry.sets.length >= MAX_SETS}
        onClick={() => dispatch({ type: 'addSet', entryKey: entry.key })}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add set
      </Button>
    </Card>
  );
}
```

- [ ] **Step 8: Replace the placeholder page**

Replace the whole of `frontend/src/features/log/LogWorkoutPage.tsx` with:

`frontend/src/features/log/LogWorkoutPage.tsx`:

```tsx
import { Check, Loader2, Plus } from 'lucide-react';
import { type FormEvent, useReducer, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useExercises, useLogWorkouts } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { todayIsoDay } from '../../lib/dates';
import { fieldErrorMap } from '../../lib/field-errors';
import { useActiveSession } from '../../session/session';
import type { HistoryLocationState } from '../history/HistoryPage';
import { EntryFields } from './EntryFields';
import {
  type LogFormAction,
  MAX_ENTRIES,
  initialLogForm,
  logFormReducer,
  setCount,
  toLogEntries,
} from './log-form';

const NO_ERRORS: ReadonlyMap<string, string> = new Map();

export function LogWorkoutPage() {
  const { userId, unit } = useActiveSession();
  const navigate = useNavigate();
  const exercises = useExercises();
  const logWorkouts = useLogWorkouts(userId);
  const today = todayIsoDay();
  const [state, dispatchForm] = useReducer(logFormReducer, undefined, () => initialLogForm(today, unit));
  // One key per form: a retry after a lost response replays instead of storing the session twice (ADR 0003).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const errors = logWorkouts.error instanceof ApiError ? fieldErrorMap(logWorkouts.error.errors) : NO_ERRORS;
  // Every entry carries the session date, so show the first entry date error on the one date field.
  const dateError = [...errors].find(([field]) => /^entries\[\d+\]\.date$/.test(field))?.[1];

  function dispatch(action: LogFormAction) {
    // Errors point at positions (entries[1].sets[0]); after an edit they may point at the wrong row.
    if (logWorkouts.isError) logWorkouts.reset();
    dispatchForm(action);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    logWorkouts.mutate(
      { entries: toLogEntries(state), idempotencyKey },
      {
        onSuccess: ({ entries, replayed }) => {
          const flash = replayed
            ? 'This workout was already saved.'
            : `Saved ${entries.length} ${entries.length === 1 ? 'exercise' : 'exercises'}.`;
          navigate('/history', { state: { flash } satisfies HistoryLocationState });
        },
      },
    );
  }

  const sets = setCount(state);
  return (
    <form noValidate onSubmit={handleSubmit}>
      <PageHeader
        title="Log workout"
        description="Record one session. Weights are stored as entered and converted wherever they are shown."
      />
      {logWorkouts.isError && <ApiErrorAlert error={logWorkouts.error} className="mb-6" />}
      {exercises.isError && <ApiErrorAlert error={exercises.error} className="mb-6" />}

      <Card className="p-4 sm:p-5">
        <Input
          label="Session date"
          type="date"
          className="sm:max-w-xs"
          value={state.date}
          max={today}
          onChange={(event) => dispatch({ type: 'setDate', date: event.target.value })}
          error={dateError}
          hint="The client's local day."
        />
      </Card>

      <ol className="mt-4 space-y-4">
        {state.entries.map((entry, index) => (
          <li key={entry.key}>
            <EntryFields
              index={index}
              entry={entry}
              exercises={exercises.data ?? []}
              errors={errors}
              canRemove={state.entries.length > 1}
              dispatch={dispatch}
            />
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => dispatch({ type: 'addEntry', unit })}
        disabled={state.entries.length >= MAX_ENTRIES}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-4 text-sm font-medium text-zinc-400 transition-colors hover:border-lime-400/40 hover:text-lime-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400 disabled:opacity-40"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add exercise
      </button>

      <div className="sticky bottom-20 z-10 mt-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900/90 p-3 pl-5 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-4">
        <p className="text-sm text-zinc-400 tabular-nums">
          {state.entries.length} {state.entries.length === 1 ? 'exercise' : 'exercises'} · {sets}{' '}
          {sets === 1 ? 'set' : 'sets'}
        </p>
        <Button type="submit" disabled={logWorkouts.isPending}>
          {logWorkouts.isPending ? (
            <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          ) : (
            <Check aria-hidden="true" className="size-4" />
          )}
          Save workout
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 9: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`
Expected: all pass, and the build ends with `✓ built`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat: log workouts with inline API errors and a per-form idempotency key"
```

### Task 10: Docker image, Compose service and docs

**Files:**
- Create: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`
- Modify: `docker-compose.yml`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces: a Compose service `web` on `${WEB_PORT:-8080}` that serves the built app and proxies `/api/*` to `http://api:3000/*`.

- [ ] **Step 1: Add the image**

`npm ci --ignore-scripts` works with a lockfile made on macOS: Vite's and Tailwind's native binaries are optional dependencies listed for every platform, not install scripts. The nginx config looks the API up through Docker's DNS on each request, rather than once at startup, so it keeps working after the API container restarts and gets a new address.

`frontend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

`frontend/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;

  # Same-origin API: /api/x is proxied to http://api:3000/x, so the API needs no CORS.
  location /api/ {
    # Docker's DNS, looked up again every 10 s: nginx starts before the API exists and follows it
    # across container restarts (a fixed proxy_pass host is resolved only once, at startup).
    resolver 127.0.0.11 valid=10s;
    set $api_upstream http://api:3000;
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass $api_upstream;
    # Right after the API container stops, its cached address stops answering and connect() would wait
    # about 15 s for "host unreachable". On the same Docker network a live API connects in under 1 ms.
    proxy_connect_timeout 3s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # Build assets have content hashes in their names, so they never change.
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  # Client-side routes (/history, /records, /log, /welcome) all load the app. index.html is revalidated on
  # every load: a stale copy would point at hashed assets that a rebuild has removed, and the page would be blank.
  location / {
    add_header Cache-Control "no-cache";
    try_files $uri /index.html;
  }
}
```

`frontend/.dockerignore`:

```text
node_modules
dist
coverage
```

- [ ] **Step 2: Add the Compose service**

In `docker-compose.yml`, replace:

```yaml
      timeout: 3s
      retries: 12

volumes:
```

with:

```yaml
      timeout: 3s
      retries: 12

  web:
    build: ./frontend
    restart: on-failure
    ports:
      - '${WEB_PORT:-8080}:80'
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      # 127.0.0.1, not localhost: nginx listens on IPv4 only, and localhost can resolve to ::1.
      test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1/ > /dev/null || exit 1']
      interval: 5s
      timeout: 3s
      retries: 12

volumes:
```

- [ ] **Step 3: Start the stack and check it**

Run (repo root):

```bash
docker compose up --build --wait
```

If port 3000 or 8080 is taken, pick others, for example `API_PORT=3300 WEB_PORT=8180 docker compose up --build --wait`, and use those ports below.
Expected: `db`, `api` and `web` report Healthy. Then:

```bash
curl -s localhost:8080/api/health                                    # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/records       # 200 (index.html for a client route)
docker compose restart api && docker compose up --wait && curl -s localhost:8080/api/health   # still {"status":"ok"}
```

- [ ] **Step 4: Document the frontend in the README**

In `README.md`, replace:

```markdown
Coaches log their clients' workouts and query history and personal records (PRs). The stack is NestJS 12, PostgreSQL 18 and TypeScript, and `docker compose up` brings it up.
```

with:

```markdown
Coaches log their clients' workouts and query history and personal records (PRs). The stack is NestJS 12, PostgreSQL 18 and TypeScript, and `docker compose up` brings it up together with a React frontend for demos.
```

In `README.md`, replace:

```markdown
docker compose up --build --wait     # API on http://localhost:3000, Postgres on localhost:5433
```

with:

```markdown
docker compose up --build --wait     # UI on http://localhost:8080, API on http://localhost:3000, Postgres on localhost:5433
```

In `README.md`, replace:

```markdown
If port 3000 or 5433 is taken, pick others: `API_PORT=3300 DB_PORT=5544 docker compose up --build --wait`, then `scripts/demo.sh http://localhost:3300`.
```

with:

```markdown
If port 3000, 5433 or 8080 is taken, pick others: `API_PORT=3300 DB_PORT=5544 WEB_PORT=8180 docker compose up --build --wait`, then `scripts/demo.sh http://localhost:3300`.
```

In `README.md`, replace:

```markdown
Invalid configuration stops the app at startup with a message naming every bad variable.

## Architecture
```

with:

````markdown
Invalid configuration stops the app at startup with a message naming every bad variable.

## Frontend

`frontend/` is a React app for demoing the API. Docker Compose serves it on http://localhost:8080.

- **Welcome:** enter or generate a client UUID. It is kept in `localStorage`, so the next visit opens that client's history.
- **History:** entries grouped by day, filtered by partial exercise name, muscle group and date range (kept in the URL), with cursor paging through "Load more".
- **Personal records:** the heaviest single set, highest-volume set and best Epley 1RM for one exercise, each with the day it was set, plus this week, month or year against the previous one.
- **Log workout:** one session of several exercises and sets in kg or lb. The API's field errors appear next to the fields. Each form sends one `Idempotency-Key`, so a retry or a double click stores the session once.
- **Load sample data:** one click logs eight weeks of workouts (48 entries, in kg and lb) for an empty client.
- A kg/lb switch in the header converts every weight on screen.

The stack is Vite 8, React 19, TypeScript, Tailwind CSS 4, TanStack Query and React Router. The browser only calls `/api/*` on its own origin. Vite (in development) and nginx (in Docker) proxy those calls to the API, so the API needs no CORS.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173; proxies /api to http://localhost:3000 (set API_URL to change it)
```

| Command (in `frontend/`) | What it does |
| --- | --- |
| `npm test` | Unit and component tests (Vitest, Testing Library, MSW); no API needed |
| `npm run lint` / `npm run typecheck` / `npm run build` | oxlint, `tsc --noEmit`, production build |
| `npm run format:check` | Prettier, with Tailwind class sorting |

## Architecture
````

- [ ] **Step 5: Tell future sessions about it in `CLAUDE.md`**

In `CLAUDE.md`, replace:

```markdown
Read the `.md` version.
```

with:

```markdown
Read the `.md` version. `frontend/` holds a React demo UI for the API (see "Frontend conventions").
```

In `CLAUDE.md`, replace:

```markdown
- `docker compose up --build --wait` — API on :3000 and Postgres 18 on :5433; migrations run on startup.
```

with:

```markdown
- `docker compose up --build --wait` — UI on :8080, API on :3000 and Postgres 18 on :5433; migrations run on startup.
```

In `CLAUDE.md`, replace:

```markdown
- `scripts/demo.sh` — curl walkthrough of every endpoint and error case.
```

with:

```markdown
- `scripts/demo.sh` — curl walkthrough of every endpoint and error case.
- `cd frontend && npm run dev` — React UI on :5173; proxies `/api` to the API on :3000 (`API_URL` overrides).
- `cd frontend && npm test` — frontend tests (Vitest, jsdom, Testing Library, MSW); `npm run lint`, `npm run typecheck`, `npm run build` and `npm run format:check` work there too.
```

In `CLAUDE.md`, replace:

```markdown
- The implementation plan is `docs/superpowers/plans/2026-10-15-workout-logging-api.md`.
```

with:

```markdown
- The implementation plan is `docs/superpowers/plans/2026-10-15-workout-logging-api.md`.

## Frontend conventions (`frontend/`)

- A separate npm package: Vite 8, React 19, Tailwind CSS 4, TanStack Query 5, React Router 7. Relative imports have no extension (bundler resolution), unlike the backend. The plan is `docs/superpowers/plans/2026-10-16-frontend-app.md`.
- The browser only calls same-origin `/api/*` (the Vite proxy in development, nginx in Docker). API calls go through `src/api`: `client.ts` (fetch and `ApiError`), `endpoints.ts`, `queries.ts` (hooks). `src/api/types.ts` mirrors the backend presenters by hand; update it when a response shape changes.
- Pages read the client and display unit with `useActiveSession()`. Filters and the selected exercise live in the URL.
- Logging validation belongs to the API: the form sends what was typed and maps `errors[].field` paths back to the inputs.
- Calendar days are local `YYYY-MM-DD` strings from `src/lib/dates.ts`, never `toISOString().slice(0, 10)`. Tests run in `Asia/Ho_Chi_Minh` with `Date` frozen at 2026-10-16 00:30 local (the UTC day is still the 15th).
- Styling: a dark zinc theme with a lime accent. Reuse the primitives in `src/components/ui`, and write Tailwind classes out in full (variant maps, no string building).
```

- [ ] **Step 6: Stop the stack and commit**

```bash
docker compose down
git add frontend/Dockerfile frontend/nginx.conf frontend/.dockerignore docker-compose.yml README.md CLAUDE.md
git commit -m "feat: serve the frontend from nginx in Docker Compose and document it"
```

### Task 11: Final verification and demo run-through

**Files:** none, unless a check fails. Fix the failure in the task that owns the file, then come back here.

- [ ] **Step 1: Frontend checks**

Run (in `frontend/`): `npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`
Expected: 15 test files and 101 tests pass, and everything else is clean.

- [ ] **Step 2: Backend checks**

Run (repo root): `npm run typecheck && npm run lint && npm test`
Expected: all pass. The backend never sees `frontend/`.

- [ ] **Step 3: Demo run-through against the real API**

Run `docker compose up --build --wait`, open http://localhost:8080 at a laptop width, and go through the demo:

1. **Welcome:** press "Generate a new client ID", then Continue. History shows "No workouts yet".
2. Press **Load sample data**. Entries appear, grouped under Today, Yesterday and earlier days.
3. Type `squat`: only Back Squat remains after a short pause. Pick **Glutes** and set From/To. Reload the page: the filters are still there. Press Clear.
4. Switch the header to **lb**: weights convert (Back Squat 100 kg shows as 220.46 lb). Switch back to kg.
5. **Personal records**, Back Squat: heaviest 135 kg and e1RM 139.5 kg on an earlier day, volume 587.5 kg on a later day. In Compare periods, Month shows one rose badge and one emerald badge. Try Week and Year.
6. **Log workout:** press Save workout with nothing filled in. An alert lists `entries[0].exerciseName`, `entries[0].sets[0].reps` and `entries[0].sets[0].weight` with a request id, and the same messages appear under the fields. Choose Bench Press, enter 5 reps × 100 kg and save. History shows "Saved 1 exercise." and the entry under Today.
7. **Idempotency:** open Personal records → Bicep Curl, which has no records, so the banner offers Load sample data. Press it. History still shows each session once: the button always sends `Idempotency-Key: sample-data-<client id>`, so the API replays the first load. The browser's network tab shows `Idempotent-Replayed: true` on that response.
8. Narrow the window to about 390 px, or use the device toolbar: the bottom tab bar appears and nothing scrolls sideways.
9. Run `docker compose stop api`, then change a filter on History. After the app's two retries, History shows "The API responded with 502 Bad Gateway" and Try again. Within about 10 s of the stop, nginx may still try the old address, so the message can read "504 Gateway Time-out" instead and take about 12 s to appear. Run `docker compose start api`, wait for it to become healthy, and press Try again: the data comes back.

Then run `docker compose down`.

- [ ] **Step 4: Hand off**

Everything is committed by the earlier tasks. Report the result of every check above. The `SessionEnd` hook appends this session to `AI_WORKFLOW.md`; review that entry for accuracy, as `CLAUDE.md` asks.
