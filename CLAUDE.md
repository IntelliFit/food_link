# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`food_link` is an AI-powered food nutrition analysis and diet-sharing WeChat Mini Program (微信小程序), backed by a Python FastAPI server and Supabase (PostgreSQL).

## Environment & Session

Before starting any non-trivial work, read `IDENTITY.md`, `SOUL.md`, `USER.md`, `PROJECT_STATE.md`, `CURRENT_TASK.md`, and `DECISIONS.md`. After confirming requirements, decisions, or milestones, persist them to those state files and to `memory/YYYY-MM-DD.md`.

## Commands

```bash
# Frontend
npm run dev:weapp              # Dev watch → local backend (127.0.0.1:3010), DO NOT use taro build directly
npm run dev:weapp:online       # Dev watch → production API (https://healthymax.cn)
npm run build:weapp            # Production build (production API)
npm run build:weapp:preview    # Preview/upload build (production API, NODE_ENV=production)
npm run lint                   # ESLint on src/
npm run typecheck              # tsc --noEmit
npm run test                   # Jest frontend tests
npm run test:watch             # Jest watch mode
npm run test:coverage          # Jest with coverage

# Backend
npm run dev:backend            # Start FastAPI + worker processes on port 3010
npm run dev:restart            # Kill old processes + restart both frontend and backend
npm run test:backend           # pytest (requires venv)
npm run test:backend:coverage  # pytest --cov

# Deployment
npm run push-docker-ccr        # Build & push backend Docker image to Tencent Cloud CCR

# Utilities
npm run iconfont               # Regenerate iconfont
python scripts/update-icon.py  # Update iconfont from latest CSS
```

## Architecture

### Frontend (Taro 4.x + React 18 + TypeScript + Vite)

**Entry point**: `src/app.tsx` → reads invite codes from mini-program QR params, applies `AppColorSchemeProvider` for theming.

**5 tab-bar pages** (main package, under 2MB limit):
| Tab | Path | Purpose |
|-----|------|---------|
| Home | `pages/index/index` | Dashboard, daily food log |
| Stats | `pages/stats/index` | Nutrition/body metrics analytics |
| Record | `pages/record/index` | Food recording (photo/text/manual) |
| Community | `pages/community/index` | Feed, check-in leaderboard |
| Profile | `pages/profile/index` | Settings, membership, cache clear |

**Subpackage** (`packageExtra/pages/`): All other pages (analyze flows, food library, friends, recipes, etc.) to avoid hitting WeChat's 2MB main-package limit.

**Key patterns**:
- API calls go through `src/utils/api.ts` (centralized fetch wrapper with token, timeout, error handling). `API_BASE_URL` is injected at build time via `defineConstants.__API_BASE_URL__`.
- `@/*` maps to `src/*` in tsconfig.
- UI framework: `@taroify/core` (Taro-adapted Vant-style components), not pure Taro components.
- Custom tab bar lives at `custom-tab-bar/` (native mini-program component, not Taro-rendered).
- Global styles: `src/app.scss`, page-specific SCSS in each page folder.
- Iconfont managed via `taro-iconfont-cli` + `scripts/update-icon.py`.
- Frontend caching strategy documented in `docs/frontend-cache-design.md`; clearing handled by `handleClearCache` in profile page.

**Build-time constants** (set in `config/index.ts`):
- `__API_BASE_URL__` — backend URL
- `__APP_VERSION__` — from `package.json` version
- `__ENABLE_DEV_DEBUG_UI__` — true only in development
- `__EXPIRY_SUBSCRIBE_TEMPLATE_ID__`

### Backend (Python FastAPI + Uvicorn)

**Entry point**: `backend/run_backend.py` → spawns multiple worker subprocesses (each imports `backend/worker.py`), then starts FastAPI on port 3010.

**Key modules**:
- `backend/main.py` (~497K) — ~100 API routes: food analysis, user profiles, community feeds, food library, friends, exercise, recipes, membership, payments, expiry management, test-backend endpoints
- `backend/database.py` (~264K) — All Supabase/Postgres operations (sync functions for worker processes, async wrappers used by FastAPI routes)
- `backend/worker.py` — Polls Supabase `analysis_tasks` table for pending tasks; runs AI analysis in background
- `backend/auth.py` — JWT creation/verification (HS256, essentially permanent tokens ~100yr expiry)
- `backend/middleware.py` — Bearer token extraction + user resolution (`get_current_user_info`, `get_optional_user_info`)
- `backend/exercise_llm.py` — LLM-based exercise calorie estimation (Instructor + OpenAI-compatible API)
- `backend/user_points.py` — Points/membership reward logic
- `backend/otel_compat.py` — OpenTelemetry tracing

**Worker types** (configured via env vars): food analysis, text analysis, health report OCR, comment moderation, public food library moderation, expiry notifications, exercise calorie estimation, precision (multi-step analysis) planning/estimation/aggregation.

**Auth flow**: WeChat login → Supabase auth → JWT issued. All protected endpoints go through `middleware.py` dependency injection.

### Database (Supabase PostgreSQL)

SQL table definitions in `backend/database/*.sql`. Key tables: `user_food_records`, `weapp_users`, `analysis_tasks`, `feed_likes_comments`, `public_food_library`, `user_body_metrics`, `user_recipes`, `food_expiry_items`, `user_friends`, `user_health_profile`, `membership_plan_config`, `user_points`, etc.

### Styles

- Sass/SCSS throughout
- Design width: 750px (standard mini-program base)
- Theme color: `#00bc7d` (green)
- Loading states: visual only (spinner/skeleton/shimmer), no "加载中" text per project convention

## Frontend Verification

UI changes MUST be verified with the `weapp-devtools` skill (WeChat DevTools automation). Do not use Playwright or Chrome MCP for this project. Provide screenshot evidence of at least one interaction or navigation check after any page/component/style/route change.

## Debugging

Follow the `jinhui-stack-debug` dependency chain when stuck: data → environment → version → config → state → network → permission → cache → build → runtime. Verify upstream dependencies before debugging the observed layer.

## Commit Convention

Conventional Commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`. Pre-commit hook auto-cleans temporary files from project root (`*.png`, `*.html`, `*.py`, `*.js`).

## Agent Do's and Don'ts

- DO NOT auto-start/stop/restart local dev servers unless the user explicitly asks. Only tell the user when a restart is needed.
- DO NOT use `taro build --type weapp --watch` directly — use the npm scripts which set correct env vars.
- DO NOT claim UI behavior is correct without runtime verification via weapp-devtools.
- DO update `PROGRESS.md` with concise git-commit-style entries after each code change.
- DO update `CURRENT_TASK.md` and `DECISIONS.md` for persistent context.
- Real device previews MUST use production API (`build:weapp:preview`), never `127.0.0.1`.
