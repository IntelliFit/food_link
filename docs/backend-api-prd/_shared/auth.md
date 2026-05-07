# Auth

Current auth entry points:

- `jwt_required`: `get_current_user_info(...)` in `backend/middleware.py`
- `jwt_optional`: `get_optional_user_info(...)` in `backend/middleware.py`
- `test_backend_cookie`: `require_test_backend_auth(...)` in `backend/main.py`
- `public`: no shared auth dependency found on the handler

Supporting source:

- `backend/middleware.py`
- `backend/auth.py`

Notes:

- Business APIs mostly use Bearer JWT in `Authorization`.
- Test backend routes use `test_backend_token` cookie and in-memory sessions.
- WebSocket `/ws/stats/insight` currently does not use the JWT dependency path.
