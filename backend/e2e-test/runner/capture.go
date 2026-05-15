package e2e

import (
	"fmt"
	"strings"

	"github.com/tidwall/gjson"
)

func captureJSON(caseName string, body string, captures map[string]string, vars map[string]string) []caseFailure {
	failures := []caseFailure{}
	for name, jsonPath := range captures {
		name = strings.TrimSpace(name)
		if name == "" {
			failures = append(failures, caseFailure{Case: caseName, Message: "capture variable name is required"})
			continue
		}
		jsonPath = replaceVars(strings.TrimSpace(jsonPath), vars)
		if jsonPath == "" {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("capture %s path is required", name)})
			continue
		}
		result := gjson.Get(body, jsonPath)
		if !result.Exists() {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("capture %s: json path %s does not exist", name, jsonPath)})
			continue
		}
		value := strings.TrimSpace(result.String())
		if value == "" {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("capture %s: json path %s is empty", name, jsonPath)})
			continue
		}
		vars[name] = value
	}
	return failures
}
