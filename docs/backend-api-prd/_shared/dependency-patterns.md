# Dependency Patterns

Shared implementation patterns seen in the current backend:

- Route handlers live in `backend/main.py`
- Database and storage operations are centralized in `backend/database.py`
- Background task execution is centralized in `backend/worker.py`
- `run_backend.py` is the full runtime entry because it starts workers before Uvicorn
- Several handlers mix validation, orchestration, and response shaping inline

Practical migration implication:

- Preserve route contracts first
- Preserve async task semantics second
- Refactor internal layering only after endpoint behavior is frozen
