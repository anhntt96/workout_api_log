# ADR 0003: Concurrent Writes and Idempotency

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Project owner (with AI-assisted analysis)

## Summary

**Decision:** Keep it simple. Writers are never serialized. Each entry carries an idempotency key, and the existing `UNIQUE (user_id, idempotency_key)` constraint from ADR 0001 makes retries safe. No extra tables.

**Why:** Entries are immutable and PRs are computed from per-entry summaries (ADR 0001), so concurrent writers share no mutable row. The only real risks are duplicate retries and two requests creating the same new exercise name. This is a home assignment, so the design avoids anything beyond that.

## Context

The brief requires correct behavior for concurrent writes: same user, same exercise, same time.

**Business rule:** the same user can log the same exercise on the same day more than once, such as a morning and an evening session. Each log is a separate entry. There is no unique constraint on `(user_id, exercise_id, performed_on)`. This corrects the "one row per exercise per day" wording in ADR 0001.

## Decision Details

### Idempotency

- Clients may send an `Idempotency-Key` header.
- A request with key `K` stores its entries with `idempotency_key` = `K#0`, `K#1`, … (the entry's position in the request). A single-entry request stores `K#0`.
- Without the header, `idempotency_key` is `NULL`, so there is no dedupe. Postgres allows many `NULL`s under a unique constraint.
- The whole request is written in one transaction: `INSERT … ON CONFLICT (user_id, idempotency_key) DO NOTHING`.
  - **Retry (sequential or parallel):** the keys already exist, so no new rows are inserted. The server reads back the existing entries by key and returns them. A parallel retry waits on the unique index until the first request commits, then does the same.
  - **First attempt failed:** the transaction rolled back, so no keys exist and a retry starts fresh.
- Bulk requests are all-or-nothing, so either every `K#i` exists or none do.

### Exercises

- Find-or-create by name uses `INSERT … ON CONFLICT (name) DO NOTHING`, then `SELECT`, so two requests creating the same new exercise don't fail.
- Exercise names in a request are deduplicated and sorted before inserting, so two bulk requests can't deadlock.

### Behavior

| Case | Result |
|---|---|
| Same user, same exercise, same day, different keys (or no key) | Both stored as separate entries, ordered by `created_at DESC, id DESC` |
| Same key, same body, sequential or parallel | One set of entries; the same entries are returned both times |
| Failure mid-request | Full rollback; safe to retry |

## Consequences

**Positive**
- No locks on user data and no new tables; it uses the schema that ADR 0001 already has.
- Retries are safe, and creating a new exercise is race-free with no deadlocks between bulk requests.

**Negative (accepted)**
- A key reused with a **different** body is not detected. The server returns the original entries. Clients must use a new key for each new request. This is documented in the API docs.
- A retry with the same key but a different number of entries is not detected either.
- Keys never expire. Cleanup is out of scope.

## Testing

- Parallel identical requests produce one set of entries.
- Concurrent requests with different keys for the same exercise keep both entries.
- Concurrent creation of the same new exercise name raises no error.
- Two bulk requests with opposite exercise orders don't deadlock.
- A rolled-back request can be retried with the same key.

## Revisit If

- Reusing a key with a different body becomes a real problem. Then add an `idempotency_keys` table that stores a payload hash and returns `409` on mismatch.
