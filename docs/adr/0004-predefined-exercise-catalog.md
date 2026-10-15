# ADR 0004: Predefined Exercise Catalog

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Project owner (with AI-assisted analysis)

## Summary

**Decision:** `exercises` is a fixed, seeded catalog. The API never creates exercises. A request's `exerciseName` must match a catalog entry, or the request fails with `400`.

**Why:** PRs compare the same exercise across periods. Free-text names split one exercise into several ("Bench Press", "bench press", "Barbell Bench"), which breaks those comparisons. A fixed list removes the problem and removes the exercise-creation code.

## Context

- ADR 0001 defines an `exercises` table with a unique name.
- ADR 0003 assumed exercises were found or created by name, and added rules for racing creators and bulk-request deadlocks.
- There is no requirement to rename or merge exercises.

## Decision Details

- The catalog is seeded by a migration. Adding an exercise means adding a migration.
- `exerciseName` is the only identifier in requests. Clients do not send an exercise id.
- Matching trims whitespace and ignores case. The response always returns the canonical catalog name.
- `GET /exercises` returns the catalog so clients can discover valid names.
- An unknown name returns `400` with the standard structured error, naming the field (`entries[2].exerciseName`). Bulk requests stay all-or-nothing, so one unknown name rejects the whole request.
- Entries keep a foreign key to `exercises.id`, so history and PRs group by id.

## Consequences

**Positive**
- Consistent data: PR and history grouping can't be split by spelling.
- Simpler writes: no find-or-create, no `ON CONFLICT (name)`, no name sorting for deadlock avoidance (ADR 0003 sections removed by this ADR).

**Negative (accepted)**
- A new exercise needs a migration and a deploy.
- Clients must handle the `400` for unknown names.
- Renaming or merging exercises is out of scope. A rename would be a data migration, and the name is the only identifier clients use.

## Testing

- A known name, in any case and with surrounding whitespace, resolves to the canonical exercise.
- An unknown name returns `400` naming the field, and nothing is stored.
- A bulk request with one unknown name stores no entries.
- `GET /exercises` returns the seeded catalog.

## Revisit If

- Users need their own exercises. Add a nullable `owner_user_id` on `exercises` and scope the name's uniqueness to the owner. This is additive.
- Exercises need renaming. Add an `exerciseId` or slug as the request identifier and treat the name as a display label.
