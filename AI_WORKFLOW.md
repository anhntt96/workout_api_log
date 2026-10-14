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

