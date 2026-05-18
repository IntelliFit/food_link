package e2e

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

var varPattern = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}`)

func ApplySeedSQL(ctx context.Context, suite *Suite, db *gorm.DB, vars map[string]string) error {
	for _, rel := range suite.SeedSQL {
		path := suite.resolvePath(rel)
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read seed sql %s: %w", rel, err)
		}
		sql := replaceVars(string(data), vars)
		if strings.TrimSpace(sql) == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply seed sql %s: %w", rel, err)
		}
	}
	return nil
}

func replaceVars(input string, vars map[string]string) string {
	return varPattern.ReplaceAllStringFunc(input, func(match string) string {
		parts := varPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		if value, ok := vars[parts[1]]; ok {
			return value
		}
		return match
	})
}

func SuiteVars(suite *Suite) map[string]string {
	vars := map[string]string{}
	for k, v := range suite.DefaultVars {
		vars[k] = v
	}
	for name, user := range suite.Auth.Users {
		vars["auth."+name+".id"] = user.ID
		vars["auth."+name+".openid"] = user.OpenID
		vars["auth."+name+".unionid"] = user.UnionID
	}
	return vars
}
