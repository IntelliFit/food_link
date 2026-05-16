---
name: go-api-loadtest
description: >
  Run Go-based load and stability tests against the backend food-analysis API.
  Use when you need to: (1) benchmark /api/analyze/submit under concurrent load,
  (2) measure end-to-end latency (submit → queue → processing → done),
  (3) validate stability with 20+ samples, or (4) compare performance across
  different analysis models (e.g., default vs qwen).
  Triggers: "run load test", "benchmark analyze API", "stress test food analysis",
  "20 sample API test", "test analysis stability", or any mention of the
  food_analysis_load build tag.
---

# Go API Load Test — Food Analysis

A Go test suite that fires concurrent requests at `/api/analyze/submit` and measures full pipeline latency.

## Source File

`backend/internal/analyze/loadtest/food_analysis_stability_test.go`

## Quick Start

```bash
cd backend
go test -tags=food_analysis_load ./internal/analyze/loadtest -v -run TestFoodAnalysisStabilityAndLatency
```

## Test Cases

| Test | Purpose |
|------|---------|
| `TestFoodAnalysisStabilityAndLatency` | Default analysis model |
| `TestFoodAnalysisStabilityAndLatencyQwen` | Forces `modelName=qwen` |
| `TestFoodAnalysisLoadCleanupUploadedImages` | Deletes orphaned COS objects by URL list |

## Configuration

All values are set via environment variables (no code changes needed).

| Variable | Default | Description |
|----------|---------|-------------|
| `FOOD_ANALYSIS_LOAD_BASE_URL` | `http://127.0.0.1:3010` | Target backend URL |
| `FOOD_ANALYSIS_LOAD_COUNT` | `20` | Number of concurrent requests |
| `FOOD_ANALYSIS_LOAD_PATTERN` | `stagger` | Launch pattern: `stagger` (interval) or `burst` (all at once) |
| `FOOD_ANALYSIS_LOAD_START_INTERVAL` | `500ms` | Delay between staggered launches |
| `FOOD_ANALYSIS_LOAD_POLL_INTERVAL` | `500ms` | How often to poll task status |
| `FOOD_ANALYSIS_LOAD_TASK_TIMEOUT` | `8m` | Max wait for a single task to finish |
| `FOOD_ANALYSIS_LOAD_IMAGE` | `testdata/food/6781F1707431AC4E3BAB1416242E433D.jpg` | Test image path (relative to backend root) |
| `FOOD_ANALYSIS_LOAD_TOKENS` | *(auto-generated)* | Comma-separated JWTs. If empty, tokens are minted locally from `backend/config.yaml` |
| `FOOD_ANALYSIS_LOAD_USER_IDS` | `food-analysis-load-user-01 …` | Comma-separated user IDs for auto token generation |
| `FOOD_ANALYSIS_LOAD_EXECUTION_MODE` | `standard` | Task execution mode: `standard` or `precision` |
| `FOOD_ANALYSIS_LOAD_MODEL` | *(empty)* | Override analysis model name |
| `FOOD_ANALYSIS_LOAD_CLEANUP_IMAGE_URLS` | *(empty)* | For cleanup test: comma-separated COS image URLs to delete |

### Flags (override env)

```bash
go test -tags=food_analysis_load ./internal/analyze/loadtest \
  -food.analysis.model=qwen \
  -food.analysis.execution_mode=precision
```

## What the Test Does

1. **Upload shared image** once via `POST /api/upload-analyze-image-file`
2. **Submit** `FOOD_ANALYSIS_LOAD_COUNT` analysis tasks via `POST /api/analyze/submit`
3. **Poll** each task via `GET /api/analyze/tasks/:task_id` until terminal status
4. **Measure**:
   - `submitDuration` — API round-trip for submit
   - `queueDuration` — time from submit ack to `status=processing`
   - `processDuration` — time from `processing` to final `done`
   - `taskDuration` — total poll wait
   - `totalDuration` — submit + poll combined
5. **Report** averages, P95, variance, stddev, success rate, and per-request breakdown
6. **Cleanup** — deletes task rows and uploaded COS objects

## Output Interpretation

Look for the `food analysis load summary` log line:

```
food analysis load summary:
  total=20 success=20 failed=0 success_rate=100.0%
  avg_processing=4.2s p95_processing=5.8s
  processing_stddev=1.1s
  avg_task_wait=4.5s p95_task_wait=6.2s
  avg_total=4.6s p95_total=6.3s
  avg_calories=512.3
```

Any `failed > 0` is surfaced as a test error with per-request logs.

## Tips

- **Ensure target DB has the auto-generated user IDs** before running, or provide real `FOOD_ANALYSIS_LOAD_TOKENS`.
- **Backend must be running** and reachable at `FOOD_ANALYSIS_LOAD_BASE_URL`.
- **COS credentials** in `backend/config.yaml` are required for image upload and cleanup.
- Use `burst` pattern to simulate flash traffic; use `stagger` for gentle ramp-up.
- The `-tags=food_analysis_load` build tag is **required** — without it the file is excluded from compilation.
