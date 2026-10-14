#!/usr/bin/env bash
# SessionEnd hook: summarizes the finished Claude Code session into an
# AI journal entry and appends it to AI_WORKFLOW.md at the project root.
#
# Runs the summarization in a detached background process so quitting
# Claude Code isn't blocked. Logs go to .claude/hooks/ai-journal.log.

set -euo pipefail

# The `claude -p` call below would itself fire SessionEnd; don't recurse.
[[ "${AI_JOURNAL_HOOK:-}" == "1" ]] && exit 0

input="$(cat)"
transcript="$(jq -r '.transcript_path // empty' <<<"$input")"
session_id="$(jq -r '.session_id // "unknown"' <<<"$input")"
reason="$(jq -r '.reason // "unknown"' <<<"$input")"
project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
[[ -z "$project_dir" ]] && project_dir="$(pwd)"

journal="$project_dir/AI_WORKFLOW.md"
log="$project_dir/.claude/hooks/ai-journal.log"

[[ -n "$transcript" && -f "$transcript" ]] || exit 0

run() {
  # Flatten the JSONL transcript into a readable conversation, keeping user
  # prompts, assistant text, and which tools were called (not their output).
  local convo
  convo="$(jq -r '
    select(.type == "user" or .type == "assistant") | select(.isMeta != true)
    | .type as $role
    | (.message.content
       | if type == "string" then [.]
         else map(
           if .type == "text" then .text
           elif .type == "tool_use" then "[tool: \(.name)] \(.input | tostring | .[0:200])"
           else empty end)
         end)
    | map(select(length > 0)) | select(length > 0)
    | "### \($role | ascii_upcase)\n" + join("\n")
  ' "$transcript" 2>/dev/null | tail -c 150000)"

  # Skip sessions with no real user prompt (e.g. opened and closed).
  grep -q '^### USER' <<<"$convo" || { echo "$(date) $session_id: empty session, skipped"; return 0; }

  local models
  models="$(jq -r 'select(.type == "assistant") | .message.model // empty' "$transcript" 2>/dev/null \
    | grep -v '^<synthetic>$' | sort -u | paste -sd, - || true)"

  local prompt
  IFS= read -r -d '' prompt <<EOF || true
You are writing one entry in an AI workflow journal (AI_WORKFLOW.md) for a software project.
Below is the transcript of one Claude Code session. Write a concise markdown entry based ONLY
on what actually happened in the transcript. Do not invent events. If a section has nothing
real to report, write "_None this session._".

Output exactly this structure, nothing before or after it:

## $(date '+%Y-%m-%d %H:%M') — <short title of what the session worked on>

**AI tools used:** Claude Code (${models:-unknown model}) — <purpose: architecture / coding / testing / debugging / documentation>

**What was done:**
- <2–5 bullets>

**AI output that was wrong or suboptimal, and how it was corrected:**
- <cases where the AI made a mistake, had to retry, got corrected by the user, or a test/command failed and was fixed>

**AI suggestions rejected (and why):**
- <cases where the user declined, denied a tool call, or redirected the AI's approach, with the reason if stated>

**Prompting strategy:**
- <how the user prompted: amount of context given, task breakdown, use of rules files / CLAUDE.md / hooks / skills, iterations>

<sub>session \`$session_id\` · ended: $reason</sub>

---

TRANSCRIPT:
$convo
EOF

  local entry
  entry="$(AI_JOURNAL_HOOK=1 claude -p --model sonnet --no-session-persistence --tools "" <<<"$prompt")" || {
    echo "$(date) $session_id: claude -p failed"; return 1; }

  # Serialize appends in case two sessions end at once.
  local lock="$journal.lock"
  until mkdir "$lock" 2>/dev/null; do sleep 1; done
  trap 'rmdir "$lock" 2>/dev/null' RETURN
  if [[ ! -s "$journal" ]]; then
    printf '# AI Workflow Log\n\nAuto-generated journal of AI-assisted sessions on this project (one entry per Claude Code session, written by a SessionEnd hook in `.claude/hooks/ai-journal.sh`). Review and edit entries for accuracy.\n\n---\n\n' > "$journal"
  fi
  printf '%s\n\n' "$entry" >> "$journal"
  echo "$(date) $session_id: entry appended"
}

if [[ "${AI_JOURNAL_FOREGROUND:-}" == "1" ]]; then
  run >>"$log" 2>&1
else
  ( run >>"$log" 2>&1 & ) </dev/null
fi
exit 0
