#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${FOOD_LINK_BACKEND_CONFIG:-$ROOT_DIR/backend/config.yaml}"
LIMIT="${1:-10}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required. Install PostgreSQL client tools first." >&2
  exit 1
fi

if [[ ! "$LIMIT" =~ ^[0-9]+$ ]] || [[ "$LIMIT" -lt 1 ]] || [[ "$LIMIT" -gt 100 ]]; then
  echo "Usage: $0 [limit], where limit is 1-100. Default: 10." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

yaml_database_value() {
  local key="$1"
  awk -v wanted="$key" '
    /^database:/ { in_db=1; next }
    /^[^[:space:]][^:]*:/ && in_db { in_db=0 }
    in_db {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      split(line, parts, ":")
      if (parts[1] == wanted) {
        sub(/^[^:]+:[[:space:]]*/, "", line)
        gsub(/^"|"$/, "", line)
        print line
        exit
      }
    }
  ' "$CONFIG_FILE"
}

DB_HOST="${POSTGRESQL_HOST:-$(yaml_database_value host)}"
DB_PORT="${POSTGRESQL_PORT:-$(yaml_database_value port)}"
DB_NAME="${POSTGRESQL_DATABASE:-$(yaml_database_value name)}"
DB_USER="${POSTGRESQL_USER:-$(yaml_database_value user)}"
DB_PASSWORD="${POSTGRESQL_PASSWORD:-$(yaml_database_value password)}"
DB_SSLMODE="${POSTGRESQL_SSLMODE:-$(yaml_database_value sslmode)}"

if [[ -z "$DB_HOST" || -z "$DB_PORT" || -z "$DB_NAME" || -z "$DB_USER" ]]; then
  echo "Database config is incomplete. Check $CONFIG_FILE or POSTGRESQL_* env vars." >&2
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

psql \
  "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=${DB_SSLMODE:-disable}" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --expanded \
  --pset=pager=off \
  --command "
SELECT
  id,
  feedback_type,
  source_task_id,
  correction_task_id,
  root_task_id,
  task_type,
  model_name,
  analysis_engine,
  created_at,
  updated_at,
  error_message,
  jsonb_pretty(COALESCE(before_result -> 'items', '[]'::jsonb)) AS before_items,
  jsonb_pretty(COALESCE(user_correction_items, '[]'::jsonb)) AS user_correction_items,
  jsonb_pretty(COALESCE(after_result -> 'items', '[]'::jsonb)) AS after_items
FROM analysis_feedback_samples
ORDER BY created_at DESC
LIMIT $LIMIT;
"
