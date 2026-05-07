# Errors

Current error behavior is partially explicit and partially implicit.

Common patterns:

- `401` for missing/invalid auth
- `404` for missing records/resources
- `400` for validation and business rule failures
- schema-readiness guards for precision / analysis task related tables
- many handlers return implicit JSON dicts without declared `response_model`

Migration note:

- Treat current successful payload shape as a compatibility surface even when it is not formally declared.
