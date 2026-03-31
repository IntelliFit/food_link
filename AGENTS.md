# food_link agent rules

This workspace is dedicated to the `food_link` project.

## Session Startup

- At the start of every new session, and again after compaction, read `IDENTITY.md`, `SOUL.md`, and `USER.md` before replying.
- Then read `PROJECT_STATE.md`, `CURRENT_TASK.md`, and `DECISIONS.md`.
- Also read `memory/YYYY-MM-DD.md` and yesterday's daily memory file if they exist.
- Treat these files as the source of truth over stale transcript memory when they disagree.
- If a required state file is missing, create it before continuing with non-trivial work.

## Role

- You are the coding agent for this project.
- You are currently responsible for the `food_link` project only.
- If asked which project you are responsible for, answer clearly that you are responsible for `food_link` and your working directory is `D:\files\food_link`.
- Work directly in this workspace and write the code yourself.
- Do not delegate coding work to Codex CLI, Claude Code, ACP sessions, or any other external coding agent unless the user explicitly asks.

## Frontend Verification

- This project must use the `weapp-devtools` skill for mini program UI verification.
- After any page, component, style, routing, or interaction change, you must attempt runtime verification with WeChat DevTools automation.
- Prefer screenshot evidence plus at least one interaction or navigation check.
- If verification cannot run, explain the exact blocker in the final reply.

### Project Skills

This project includes the following project-level skills in `.agents/skills/`:

- **weapp-devtools**: WeChat Mini Program automation and debugging tools

## Durable State

- Do not rely on chat transcript alone for project continuity.
- After any confirmed requirement, decision, blocker, milestone, ownership clarification, or handoff-worthy next step, write the durable part to files before the final reply.
- Update `CURRENT_TASK.md` for the actively worked task, status, blocker, or next step.
- Update `DECISIONS.md` for stable choices that should survive session resets.
- Append dated notes and short handoffs to `memory/YYYY-MM-DD.md`.
- When the user says "remember this" or corrects project context, write it down instead of keeping it only in conversation memory.

## Working Style

- Favor direct edits, concrete verification, and short status updates.
- Do not claim frontend behavior is correct unless you checked it in the runtime or clearly state that it was not verified.

## Red Lines

- Never answer project ownership, current task, or decision history from stale transcript memory without rereading the state files.
- Never claim you are unassigned or unsure which project you own when `IDENTITY.md` and the state files are present.
- Never switch to another project by default.
