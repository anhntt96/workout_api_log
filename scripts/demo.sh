#!/usr/bin/env bash
# Walks through every endpoint, including error handling. Run after `docker compose up --wait`.
# Requires curl, jq and uuidgen. Usage: scripts/demo.sh [base-url]
set -euo pipefail

BASE_URL=${1:-http://localhost:3000}
CLIENT=$(uuidgen | tr '[:upper:]' '[:lower:]')
USER_PATH="/users/$CLIENT"

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
call POST "$USER_PATH/workout-entries" -H 'Idempotency-Key: demo-session-1' -d "$SESSION"

section 'Retry with the same Idempotency-Key: nothing new is stored'
curl -sS -o /dev/null -D - -X POST "$BASE_URL$USER_PATH/workout-entries" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-session-1' -d "$SESSION" | grep -i -E '^(HTTP|idempotent-replayed)'

section 'More sessions'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":"2026-09-22","exerciseName":"Bench Press","sets":[{"reps":1,"weight":110,"unit":"kg"}]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries":[
  {"date":"2026-10-06","exerciseName":"Bench Press","sets":[{"reps":3,"weight":112.5,"unit":"kg"},{"reps":8,"weight":95,"unit":"kg"}]},
  {"date":"2026-10-06","exerciseName":"Pull-Up","sets":[{"reps":10,"weight":0,"unit":"kg"}]}
]}'

section 'History: newest first, converted, filtered, paginated'
call GET "$USER_PATH/workout-entries"
call GET "$USER_PATH/workout-entries?unit=lb"
call GET "$USER_PATH/workout-entries?exerciseName=press&muscleGroup=chest"
call GET "$USER_PATH/workout-entries?from=2026-10-01&to=2026-10-31"
call GET "$USER_PATH/workout-entries?from=2025-01-01&to=2025-01-31"
NEXT=$(curl -sS "$BASE_URL$USER_PATH/workout-entries?limit=2" | jq -r .page.nextCursor)
call GET "$USER_PATH/workout-entries?limit=2&cursor=$NEXT"

section 'Personal records'
call GET "$USER_PATH/personal-records?exerciseName=bench%20press"
call GET "$USER_PATH/personal-records?exerciseName=Bench%20Press&unit=lb"
call GET "$USER_PATH/personal-records/comparison?exerciseName=Bench%20Press&from=2026-10-01&to=2026-10-31&baselineFrom=2026-09-01&baselineTo=2026-09-30"

section 'Error handling'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"stone"}]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":null,"exerciseName":"Bench Press","sets":[]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":-1,"weight":-5,"unit":"kg"}]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":"2026-09-08T06:00:00","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries":[{"date":"2030-01-01","exerciseName":"Benchpress","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
call POST "$USER_PATH/workout-entries" -d '{"entries": ['
call POST /users/not-a-uuid/workout-entries -d '{"entries":[{"date":"2026-09-08","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
call GET "$USER_PATH/workout-entries?exercise=bench"
call GET "$USER_PATH/workout-entries?muscleGroup=wings"
call GET "$USER_PATH/workout-entries?cursor=garbage"
call GET "$USER_PATH/personal-records?exerciseName=Bench%20Press&from=2026-10-31&to=2026-10-01"
