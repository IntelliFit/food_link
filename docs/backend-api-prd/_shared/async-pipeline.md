# Async Pipeline

The current backend runtime is not HTTP-only.

Worker-sensitive flows include:

- food analysis submit / task polling
- text food analysis submit / task polling
- precision planning / item estimate / aggregate
- health report extraction tasks
- comment moderation tasks
- expiry notification jobs
- exercise async fallback tasks

Primary runtime source:

- `backend/run_backend.py`
- `backend/worker.py`
- task helpers in `backend/database.py`
