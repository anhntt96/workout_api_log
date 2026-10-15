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
