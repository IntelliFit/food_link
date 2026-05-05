# Extraction Rules

This document set was generated from code facts plus lightweight heuristics.

Auto-derived facts:

- path, method, handler name, source line
- auth dependency type
- request model names
- declared `response_model`
- direct database helper calls
- direct worker helper calls
- detected `HTTPException(status_code=...)`
- mini program caller matches

Manual interpretation still required for:

- implicit response field shapes
- deep business rules
- hidden coupling through local helpers
- operational callers for backend-only routes
