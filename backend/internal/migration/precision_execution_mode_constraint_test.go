package migration

import (
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestPrecisionSessionExecutionModeConstraintAcceptsStrictSeparate(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
CREATE TABLE precision_sessions (
  id text PRIMARY KEY,
  execution_mode text NOT NULL
)`).Error)
	require.NoError(t, db.Exec(`
ALTER TABLE precision_sessions
ADD CONSTRAINT precision_sessions_execution_mode_check
CHECK (execution_mode = ANY (ARRAY['standard'::text, 'strict'::text]))`).Error)
	require.Error(t, db.Exec(`INSERT INTO precision_sessions (id, execution_mode) VALUES ('before-fix', 'strict_separate')`).Error)

	statement := dropAndAddCheck(
		"precision_sessions",
		"precision_sessions_execution_mode_check",
		precisionSessionExecutionModeCheckExpression,
	)
	require.NoError(t, db.Exec(statement).Error)
	require.NoError(t, db.Exec(statement).Error, "约束迁移必须可重复执行")
	require.NoError(t, db.Exec(`INSERT INTO precision_sessions (id, execution_mode) VALUES ('after-fix', 'strict_separate')`).Error)

	var mode string
	require.NoError(t, db.Raw(`SELECT execution_mode FROM precision_sessions WHERE id = 'after-fix'`).Scan(&mode).Error)
	require.Equal(t, "strict_separate", mode)
}
