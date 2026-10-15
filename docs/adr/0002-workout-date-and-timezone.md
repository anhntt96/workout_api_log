# ADR 0002: Workout Date and Timezone Handling

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Project owner (with AI-assisted analysis)

## Summary

**Decision:** Store the workout day as a calendar `DATE` (`performed_on`). Store every real moment, such as `created_at`, as `TIMESTAMPTZ` in UTC. The API accepts either a plain date or an ISO 8601 datetime with an explicit offset.

| Field | Type | Meaning |
|---|---|---|
| `performed_on` | `DATE NOT NULL` | The client's local calendar day of the workout. All filters, PR ranges and comparisons use this column. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | When the row was written, in UTC. Used for audit and for ordering entries within the same day. |

## Context

- The brief's input field is `date`. It recommends UTC storage and asks for the trade-offs to be documented.
- PR comparisons ("this month vs last month") and history date filters group entries by calendar day and month.
- Coaches often log workouts after the fact ("Tuesday's session"). They know the day, not the exact moment.
- The API has no users table and no stored time zone per user.

A workout day is a calendar fact, not a moment in time. Storing it as a UTC timestamp without the client's time zone moves it onto the wrong day. A Hanoi (UTC+7) workout at 06:00 on Oct 14 is `2026-10-13T23:00Z`. Near the start or end of a month, the workout falls into the wrong month and skews PR comparisons.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| **A. `performed_at TIMESTAMPTZ` only** | Literal UTC storage; exact moment kept | Grouping by day or month needs each user's time zone, which the API doesn't have. Workouts near midnight land on the wrong day or month. |
| **B. `performed_on DATE` + UTC `created_at`** (chosen) | No time-zone logic on the server; date ranges are plain indexed comparisons; matches the `date` input | Exact time of day is lost |
| **C. Both `performed_at` and `performed_on`, plus an IANA time zone** | Keeps all the information | More input to validate, and no current requirement needs the time of day |

## Decision Details

### Input formats for `date`

| Input | Accepted | Stored `performed_on` |
|---|---|---|
| `2026-10-14` | Yes | `2026-10-14` |
| `2026-10-14T06:00:00+07:00` | Yes | `2026-10-14`, the date in the offset given |
| `2026-10-13T23:00:00Z` | Yes | `2026-10-13`. `Z` means the client chose UTC. |
| `2026-10-14T06:00:00` (no offset) | No, `400` | Ambiguous: no time zone to read the date in |
| `null`, missing, `2026-02-30`, `14/10/2026` | No, `400` | — |

**Rule:** the date is read in the offset the client sends. The server never converts to UTC before taking the date.

**Client guidance (API docs):** send `YYYY-MM-DD`, or a datetime with your **local** offset. Don't send `Date.prototype.toISOString()` output. It is always UTC (`Z`), so the date can be a day off for clients far from UTC.

### Validation

- Reject dates more than one day in the future, measured from the current UTC date. The one-day slack covers clients in time zones ahead of UTC.
- All validation errors use the API's standard structured error format and name the field (`entries[2].date`).

### Querying

- History filters take inclusive date bounds, `from=YYYY-MM-DD&to=YYYY-MM-DD`, compared directly against `performed_on`.
- PR comparison takes explicit date ranges for each period. The server doesn't work out "this month" itself, because that depends on the client's time zone.
- Entries on the same day are ordered by `created_at DESC, id DESC`.

## Consequences

**Positive**
- The server and database contain no time-zone arithmetic. Date filters and month comparisons are exact and fully covered by the `(user_id, …, performed_on)` indexes.
- A workout always appears on the day the client experienced it, including when they travel.
- Every stored instant (`created_at`) is in UTC, in line with the brief's recommendation.

**Negative**
- Time of day is not recorded.
- Clients that send UTC datetimes may log the wrong day. This is mitigated by the client guidance above and by `YYYY-MM-DD` being the documented primary format.
- A range like "this month" has to be computed by the client.

## Revisit If

- A feature needs time of day, such as "morning vs evening performance" or several sessions per day. In that case, add a nullable `performed_at TIMESTAMPTZ` and an optional IANA `timezone`. This is purely additive, and `performed_on` stays the field everything filters on.
- User profiles with a stored time zone are introduced. The server could then resolve relative ranges like "this month" itself.
