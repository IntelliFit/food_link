---
name: foodlink-pr-review
description: Review, organize, commit, push, and create Foodlink pull requests targeting dev. Use when the user asks for daily end-of-day review, current-branch review, change grouping or splitting, commit preparation, or automated PR creation. Block publishing on serious bugs, security risks, destructive data changes, missing migrations, failing checks, or ambiguous mixed scope.
---

# Foodlink Review and PR Automation

Review first; publish only changes that pass every gate. Never modify business code while using this skill.

## Fixed policy

- Compare against `origin/dev` using the merge base.
- Target every PR at `dev`; never target or update `main`.
- Treat staged, unstaged, and untracked files as review input.
- Stage only explicitly classified files or hunks. Never use `git add -A` in a mixed worktree.
- Preserve unrelated user changes.
- Create Draft PRs unless the user explicitly requests ready-for-review.
- Do not deploy backend, upload a mini program, or merge a PR.
- Reuse the existing current branch only when it contains one coherent change. Otherwise create `codex/<scope>` branches/worktrees from current `origin/dev`.
- Load and follow the project `code-review`, `github:yeet`, and relevant verification skills.

## Workflow

### 1. Establish the baseline

1. Read the project state files required by `AGENTS.md`.
2. Run `git status --short --branch`, `git remote -v`, and `git fetch origin dev`.
3. Resolve `origin/dev`, the current branch, and the merge base.
4. Inventory:
   - `git log origin/dev..HEAD --oneline`
   - `git diff --stat origin/dev...HEAD`
   - `git diff origin/dev...HEAD`
   - `git diff`, `git diff --cached`, and untracked files.
5. Stop if `dev` cannot be resolved, GitHub authentication is unavailable, or the worktree ownership is unclear.

### 2. Classify changes by intent

Assign every changed file and hunk to one coherent purpose:

- feature
- bug fix
- refactor
- test
- documentation/tooling
- local-only state or generated artifact
- unrelated/unknown

Combine changes only when they implement or verify the same user-visible behavior or root-cause fix. Keep tests and documentation with the behavior they validate.

Split changes when they affect unrelated features, independent bug fixes, different deployment surfaces, or local state. Do not publish secrets, `.env*`, credentials, generated builds, screenshots, local project configuration, outputs, or unrelated memory files.

If unrelated hunks are interleaved in one file and cannot be staged safely without editing business code, stop and report the ambiguity. Do not guess.

### 3. Review each proposed group

Use two independent axes:

1. **Standards**: project rules, architecture, code style, duplication, naming, error handling, loading-state rules, logging rules, migration rules, and code smells.
2. **Spec**: requested behavior, missing requirements, scope creep, incorrect implementation, and regression risk.

Check at minimum:

- obvious bugs, nil/undefined paths, races, navigation/state errors, and unhandled failures
- duplicate logic that should reuse existing modules or APIs
- impact on existing flows, themes, cache, authentication, backend contracts, and database schema
- secret exposure and unsafe destructive actions
- required Go migration model and idempotent migration code for schema changes
- whether tests cover the changed behavior
- whether the diff contains unrelated or generated content

Rank findings:

- **Blocker**: security/secret exposure, data loss, broken build, invalid migration, production outage risk, or changes outside authorized scope.
- **High**: user-visible core flow broken, substantial regression, failing required tests, or incorrect API/data behavior.
- **Medium/Low**: non-blocking maintainability, clarity, or polish.

Any Blocker or High finding stops commit, push, and PR creation. Output a problem report with file, line, evidence, impact, and recommended next step. Do not fix business code.

### 4. Verify the proposed group

Run checks based on touched surfaces:

- WeChat: `npm run typecheck`, `npm run lint`, `npm test -- --runInBand`; for UI changes, attempt `weapp-devtools` runtime verification without running `npm run build:weapp`.
- Admin: `npm --prefix admin run build`.
- Go backend: `gofmt` check on changed Go files and the narrowest relevant `go test`; expand only when proportional to risk.
- General: `git diff --check` and inspect the staged diff again.

A missing runtime automation port may be reported as a limitation rather than a serious defect when static checks pass. A failing required check blocks publishing.

### 5. Commit intentionally

For every passing group:

1. Create or select the appropriate `codex/<scope>` branch based on current `origin/dev`.
2. Stage only the group's explicit paths/hunks.
3. Re-read `git diff --cached --stat` and `git diff --cached`.
4. Use Conventional Commit format:
   - `feat(scope): ...`
   - `fix(scope): ...`
   - `refactor(scope): ...`
   - `test(scope): ...`
   - `docs(scope): ...`
   - `chore(scope): ...`
5. Let the repository pre-commit hook run. Never bypass it with `--no-verify`.

### 6. Push and create the PR

1. Confirm `gh auth status`.
2. Push only the reviewed branch.
3. Create a Draft PR targeting `dev`.
4. If multiple independent groups exist, create separate branches and PRs. Never bundle them only for convenience.
5. Do not create a duplicate PR when the branch already has an open PR; update that PR instead.

Use this PR body:

```markdown
## 修改总结
- ...

## 修改文件
- `path`: purpose

## 影响范围
- 用户流程：
- 前端/后端/数据：
- 兼容性与回归风险：

## 测试结果
- [x] command — result
- [ ] runtime check — blocker or reason not run

## 注意事项
- ...
```

### 7. Report the outcome

Always report:

- baseline and branch
- groups found and how they were split
- review findings by Standards and Spec
- commits created
- PR URLs targeting `dev`
- tests and runtime verification
- excluded files and why
- blockers or follow-up actions

If no safe publishable group exists, create no commit and no PR.
