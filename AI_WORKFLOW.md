# AI Workflow Log

Auto-generated journal of AI-assisted sessions on this project (one entry per Claude Code session, written by a SessionEnd hook in `.claude/hooks/ai-journal.sh`). Review and edit entries for accuracy.

---

## 2026-10-14 21:44 — Setting up a SessionEnd hook to auto-generate AI_WORKFLOW.md journal entries

**AI tools used:** Claude Code (claude-opus-5-5) — coding / documentation (building and testing a Claude Code hook that writes the AI journal)

**What was done:**
- Invoked the `update-config` skill and inspected the project (existing `.claude/`, settings, `AI_WORKFLOW.md`, availability of `claude` and `jq`).
- Wrote `.claude/hooks/ai-journal.sh`, which reads the session transcript, summarizes it with `claude -p` (Sonnet), and appends an entry to `AI_WORKFLOW.md`.
- Registered the hook in `.claude/settings.json` under `SessionEnd`.
- Tested the script against this session's real transcript in foreground and background modes, then deleted the test output (`AI_WORKFLOW.md`, hook log).
- Added behaviours: background execution, recursion guard via an environment variable, lock against concurrent sessions, skipping empty sessions, and logging to `.claude/hooks/ai-journal.log`.

**AI output that was wrong or suboptimal, and how it was corrected:**
- The first version of the script failed on macOS bash 3.2, which mis-parses apostrophes inside a heredoc nested in `$(...)`. The AI rewrote that part to use `IFS= read -r -d '' prompt <<EOF`.
- The summarizer ran on Sonnet and so recorded "Sonnet" as the model used in entries. The AI changed the script to pull the real model name(s) from the transcript's assistant messages with `jq`.

**AI suggestions rejected (and why):**
- _None this session._

**Prompting strategy:**
- A single short instruction (set up a SessionEnd hook that writes the AI journal to `AI_WORKFLOW.md`), plus the assignment's AI-workflow-log requirements pasted in as the spec for what entries should contain.
- No rules files or CLAUDE.md were used. The AI worked autonomously from that one prompt, with no follow-up corrections from the user.

<sub>session `9238b4a2-d4b4-45d8-b3ff-f54dec61ad86` · ended: clear</sub>

## 2026-10-15 07:29 — Database selection and workout date/timezone ADRs, PR for ADR 0001

**AI tools used:** Claude Code (claude-opus-5-5) — architecture / documentation

**What was done:**
- Read the Everfit backend test brief (PDF) and discussed schema design using the brainstorming skill. The PostgreSQL vs MongoDB trade-offs were compared in detail.
- Wrote `docs/adr/0001-database-selection.md`. After the user chose PostgreSQL, it was marked Accepted and given a top Summary section. The Summary includes a Mermaid ER diagram and the per-entry `best_weight_kg`, `best_volume_kg` and `best_e1rm_kg` summary fields.
- Decided that `performed_on` is a `DATE` holding the client's calendar day, with `created_at` as a UTC `TIMESTAMPTZ`. The API accepts either `YYYY-MM-DD` or an ISO datetime with an offset. This was recorded in a new `docs/adr/0002-workout-date-and-timezone.md`, which is still uncommitted.
- Ran `git init`, created a private GitHub repo and opened PR #1 for ADR 0001. The PR description flags the stale detailed Option A section and the not-yet-merged ADR 0002 link.

**AI output that was wrong or suboptimal, and how it was corrected:**
- The first case for PostgreSQL overstated the problem with MongoDB. It said MongoDB would need `$unwind` over every set for PRs. When the user asked whether MongoDB was valid too, the AI conceded this only holds for a naive schema. It then showed a well-designed MongoDB layout with precomputed `best.*` fields and wrote MongoDB up as a full option in the ADR.
- The AI first accepted the user's idea of storing the two best-set fields on entries as a clear win. It then reframed this: for single PR lookups the index already makes data size irrelevant, and the real benefit is a simpler schema with no copied columns on sets. It also added a third field, best estimated 1RM, since it can come from a different set. After the user cited the 50k+ entries requirement, it gave a per-query breakdown of where the fields help (long-range comparisons, multi-exercise aggregates, index size) and where they don't.
- Before writing ADR 0002 the AI caught its own earlier advice. It had suggested taking the date from the client's offset, but `new Date().toISOString()` always sends UTC (`Z`), so a Hanoi client at 06:00 on Oct 14 would be stored as Oct 13. The ADR therefore says clients must send their local offset and must not send `toISOString()` output.
- ADR 0001 is internally inconsistent. The detailed Option A section still shows the old per-set design with copied columns, and only a one-line note flags this. It was left unfixed and noted in the PR.
- The Mermaid diagram was never rendered or checked. This was disclosed to the user and listed in the PR test plan.

**AI suggestions rejected (and why):**
- _None this session._ The user did not deny any tool call or reject a proposal. They redirected twice: they asked for MongoDB to be taken seriously after the first recommendation, and they supplied the 50k-entries rationale for the summary fields.

**Prompting strategy:**
- The user started with the brainstorming skill and the brief attached via `@`. They asked to "discuss" schema design, so the AI went through it one step at a time.
- The user then moved to short, concrete requests: write an ADR, add summary fields, add a Mermaid diagram, "accepting both" for date formats, and open a PR. They tied the `@docs/adr/0001-database-selection.md` file reference to the edit requests.
- The user pushed back with questions ("why PostgreSQL?", "what is your idea for performed_on?") before deciding.
- The diagram request was sent twice. The second version added `@docs/adr/0001-database-selection.md` to say where it should go.
- Effort was set to medium via `/effort` at the start.

<sub>session `916c2ec0-bf04-446d-985a-f3d5af5812d0` · ended: clear</sub>

## 2026-10-15 07:36 — Open PR for ADR 0002 (workout date and timezone)

**AI tools used:** Claude Code (claude-sonnet-5-5) — documentation / git workflow

**What was done:**
- Switched the session model to Sonnet 5.5 with `/model` and saved it as the default.
- Inspected git state, remotes, existing PRs and the ADR 0002 file. Fetched `origin/main` and cut the branch `docs/adr-0002-workout-date-timezone` from it, because the previous branch was the already-merged ADR 0001 branch.
- Committed only `docs/adr/0002-workout-date-and-timezone.md` in one commit (`docs: add ADR 0002 on workout date and timezone handling`) and opened PR #2: https://github.com/anhntt96/workout_api_log/pull/2
- Left the uncommitted edit to `AI_WORKFLOW.md` out of the PR. It is still modified in the working tree.

**AI output that was wrong or suboptimal, and how it was corrected:**
- _None this session._

**AI suggestions rejected (and why):**
- _None this session._

**Prompting strategy:**
- A single short instruction ("create a PR for ADR 0002") with no extra context. The AI worked out the branch, scope and base itself from the repo state.
- No rules files, hooks or skills were used visibly in the transcript, and there were no follow-up iterations.

<sub>session `e19be219-dfa4-4490-bc51-a606c45041fc` · ended: clear</sub>

## 2026-10-15 08:38 — ADR 0003: concurrent writes and idempotency

**AI tools used:** Claude Code (claude-sonnet-5-5) — architecture / documentation

**What was done:**
- Used the brainstorming skill to design how to handle the same user logging the same exercise at the same time. The AI read ADR 0001 and 0002 first, then narrowed the design through a few questions to the user.
- Decided that same-day repeats are kept as separate entries, and that exercise find-or-create uses `ON CONFLICT` with names sorted to avoid deadlocks.
- Wrote ADR 0003 and patched ADR 0001 (the "one row per exercise per day" wording and links to ADR 0003).
- Opened PR #3 on a fresh branch from `origin/main`, rewrote the ADR in a simpler form and updated the PR description, then squashed the two commits into one and force-pushed.

**AI output that was wrong or suboptimal, and how it was corrected:**
- The first ADR commit (`2a47278`) landed on the already-merged ADR 0002 branch. The AI cherry-picked it onto a new branch from `origin/main` to fix this.
- The first version of ADR 0003 was more complex than the user wanted (separate `idempotency_keys` table, payload hash, `409`). The user asked for a rewrite, and the AI replaced it with the simpler design and restored the `idempotency_key` column and `ON CONFLICT` bullet in ADR 0001.
- The AI wrote ADR 0003 straight from the approved design without reviewing the text, and said so. It asked the user to read it before going further.

**AI suggestions rejected (and why):**
- The user chose option 2, the separate `idempotency_keys` table, then reversed it after the PR was open: "Select option A because this is a simple home assignment, keep everything at simple". The user's reason was the simplicity of the assignment. The design was replaced with per-entry keys (`K#0`, `K#1`, …) in the existing `UNIQUE (user_id, idempotency_key)` column.

**Prompting strategy:**
- The user started with a short one-line question through the brainstorming skill and let the AI explore the repo itself.
- They steered with single-word answers ("A", "yes", "yes, select option 2") to the AI's multiple-choice questions.
- They gave short follow-up instructions: "create a PR", then the rewrite, then "squash them before merging". Scope was only corrected after seeing the first result.
- The AI did not merge the PR, since the user only asked for a squash.

<sub>session `97949b4f-bb2d-4446-bebe-772aa78c073f` · ended: clear</sub>

## 2026-10-15 08:45 — ADR 0004: predefined exercise catalog

**AI tools used:** Claude Code (claude-sonnet-5-5) — architecture / documentation

**What was done:**
- Brainstormed the "predefined exercises, users can't input new ones" idea via `/superpowers:brainstorming`. The design covered a read-only seeded catalog, `GET /exercises`, a `400` for unknown names, and case-insensitive matching.
- Wrote `docs/adr/0004-predefined-exercise-catalog.md`. `exerciseName` stays the identifier. Rename and merge are out of scope.
- Added a one-line "superseded in part by ADR 0004" note at the top of ADR 0003 and left the rest of 0003 unchanged.
- Created branch `docs/adr-0004-predefined-exercises`, committed the two ADR files, and opened PR #4 with the ADR 0003 branch as its base. The uncommitted `AI_WORKFLOW.md` changes were left out of the PR.

**AI output that was wrong or suboptimal, and how it was corrected:**
- The AI treated "we don't have rename requirement, just keep it simple" as approval of the design and wrote the ADR without an explicit yes. It said so afterward and asked the user to review before committing. The user then asked for the PR.
- ADR 0003 still lists exercise-creation tests and the sorted-names deadlock rule, which no longer apply. The AI flagged this and offered to strip them, but no cleanup happened this session.

**AI suggestions rejected (and why):**
- The user interrupted the AI's first exploration (reading ADR 0003 and 0002) and re-issued the request through the brainstorming skill. No reason was stated.
- The AI offered `exerciseId` or a slug as the stable identifier. The user declined because there is no rename requirement and they wanted to keep it simple.

**Prompting strategy:**
- The user opened with a one-line design constraint and then asked "What do you think?", which invited discussion before any writing.
- They answered the AI's single clarifying question briefly and later gave short commands ("create a PR for ADR 0004").
- They used the brainstorming skill and the existing ADRs as context and gave no long upfront spec.

<sub>session `5930f78a-dc8d-4076-8957-f6626dcd4890` · ended: clear</sub>

## 2026-10-15 08:48 — Generate CLAUDE.md via /init

**AI tools used:** Claude Code (claude-sonnet-5-5) — documentation

**What was done:**
- Ran `/init` to create a `CLAUDE.md` at the repo root. The AI inspected the repo state, the AI-journal hook and settings, and the ADRs 0001–0004.
- `CLAUDE.md` summarizes the project state (take-home Workout Logging API, no application code yet) and the key decisions from each ADR: PostgreSQL schema, date and timezone handling, idempotency, and the fixed exercise catalog.
- It also records the documentation and PR conventions and explains how the `SessionEnd` hook generates `AI_WORKFLOW.md`.
- The AI noted that ADR 0001's detailed "Option A" section is stale and that its Summary is authoritative.
- It left the file uncommitted and omitted a Commands section because no build, lint or test tooling exists yet.

**AI output that was wrong or suboptimal, and how it was corrected:**
- The AI could not read the assignment brief PDF. `pdftotext` produced nothing, and the AI reported that `pdftoppm` was missing (fixable with `brew install poppler`). `CLAUDE.md` is therefore based only on the ADRs and the hook script, and the AI flagged that it should be rechecked against the brief once code exists.

**AI suggestions rejected (and why):**
- _None this session._

**Prompting strategy:**
- The user ran `/clear` and then the built-in `/init` command with no extra arguments. The AI explored the repo on its own, and there was no iteration within the session.
- The output is meant to guide later sessions. It captures the ADR conventions and the hook-based journal workflow.

<sub>session `3e79085d-aac2-45bb-95af-774000383a5a` · ended: clear</sub>

