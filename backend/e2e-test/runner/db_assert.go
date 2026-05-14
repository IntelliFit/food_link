package e2e

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

func assertDatabase(ctx context.Context, db *gorm.DB, caseName string, assertions []DBAssert, vars map[string]string) []caseFailure {
	failures := []caseFailure{}
	for i, assertion := range assertions {
		item := materializeDBAssert(assertion, vars)
		if names := dbAssertUnresolvedVars(item); len(names) > 0 {
			failures = append(failures, caseFailure{
				Case:    caseName,
				Message: fmt.Sprintf("db_assert[%d] unresolved variable(s): %s; define them in default_vars/auth users or create them in an earlier capture step", i, strings.Join(names, ", ")),
			})
			continue
		}
		if item.Query == "" {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("db_assert[%d] query is required", i)})
			continue
		}
		actual, exists, err := queryFirstColumn(ctx, db, item.Query, item.Args...)
		if err != nil {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("db_assert[%d] query failed: %v", i, err)})
			continue
		}
		if ok, msg := matchExpectation(actual, exists, item.Equals); !ok {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("db_assert[%d]: %s", i, msg)})
		}
	}
	return failures
}

func queryFirstColumn(ctx context.Context, db *gorm.DB, query string, args ...any) (any, bool, error) {
	rows, err := db.WithContext(ctx).Raw(query, args...).Rows()
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, false, nil
	}
	var value any
	if err := rows.Scan(&value); err != nil {
		return nil, false, err
	}
	switch v := value.(type) {
	case []byte:
		return string(v), true, nil
	default:
		return v, true, nil
	}
}
