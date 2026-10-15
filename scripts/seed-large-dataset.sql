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
