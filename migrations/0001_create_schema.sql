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
