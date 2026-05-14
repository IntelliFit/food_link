package e2e

import (
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
)

type caseFailure struct {
	Case    string
	Message string
}

type caseReporter struct {
	caseName string
	failures []caseFailure
}

func (r *caseReporter) Errorf(message string, args ...interface{}) {
	r.failures = append(r.failures, caseFailure{
		Case:    r.caseName,
		Message: fmt.Sprintf(message, args...),
	})
}

func assertHeaders(caseName string, headers map[string][]string, expected map[string]any) []caseFailure {
	failures := []caseFailure{}
	for key, want := range expected {
		actual := strings.Join(headers[httpCanonicalHeader(key)], ",")
		if actual == "" {
			actual = strings.Join(headers[key], ",")
		}
		if ok, msg := matchExpectation(actual, actual != "", want); !ok {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("header %s: %s", key, msg)})
		}
	}
	return failures
}

func assertJSON(caseName string, body string, expected map[string]any) []caseFailure {
	failures := []caseFailure{}
	for path, want := range expected {
		result := gjson.Get(body, path)
		actual := any(result.Value())
		if ok, msg := matchExpectation(actual, result.Exists(), want); !ok {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("json %s: %s", path, msg)})
		}
	}
	return failures
}

func assertBodyContains(caseName string, body string, values []string) []caseFailure {
	failures := []caseFailure{}
	for _, value := range values {
		if !strings.Contains(body, value) {
			failures = append(failures, caseFailure{Case: caseName, Message: fmt.Sprintf("body does not contain %q", value)})
		}
	}
	return failures
}

func matchExpectation(actual any, exists bool, expected any) (bool, string) {
	switch want := expected.(type) {
	case string:
		switch {
		case want == "exists":
			if exists {
				return true, ""
			}
			return false, "expected to exist"
		case want == "not_empty":
			if exists && strings.TrimSpace(fmt.Sprint(actual)) != "" {
				return true, ""
			}
			return false, "expected to be non-empty"
		case strings.HasPrefix(want, "type:"):
			typ := strings.TrimPrefix(want, "type:")
			if matchesType(actual, typ) {
				return true, ""
			}
			return false, fmt.Sprintf("expected type %s, got %T (%v)", typ, actual, actual)
		case strings.HasPrefix(want, "regex:"):
			pattern := strings.TrimPrefix(want, "regex:")
			ok, err := regexp.MatchString(pattern, fmt.Sprint(actual))
			if err != nil {
				return false, fmt.Sprintf("invalid regex %q: %v", pattern, err)
			}
			if ok {
				return true, ""
			}
			return false, fmt.Sprintf("expected %q to match %q", actual, pattern)
		default:
			if fmt.Sprint(actual) == want {
				return true, ""
			}
			return false, fmt.Sprintf("expected %q, got %q", want, actual)
		}
	default:
		if numbersEqual(actual, want) {
			return true, ""
		}
		if reflect.DeepEqual(normalizeJSONNumber(actual), normalizeJSONNumber(want)) {
			return true, ""
		}
		a, _ := json.Marshal(actual)
		w, _ := json.Marshal(want)
		return false, fmt.Sprintf("expected %s, got %s", string(w), string(a))
	}
}

func matchesType(value any, typ string) bool {
	switch typ {
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		switch value.(type) {
		case float64, float32, int, int64, int32, json.Number:
			return true
		default:
			_, err := strconv.ParseFloat(fmt.Sprint(value), 64)
			return err == nil
		}
	case "bool", "boolean":
		_, ok := value.(bool)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		_, ok := value.([]any)
		return ok
	case "null":
		return value == nil
	default:
		return false
	}
}

func numbersEqual(a, b any) bool {
	af, aok := asFloat(a)
	bf, bok := asFloat(b)
	return aok && bok && af == bf
}

func asFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func normalizeJSONNumber(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range v {
			out[key] = normalizeJSONNumber(item)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = normalizeJSONNumber(item)
		}
		return out
	default:
		return value
	}
}

func httpCanonicalHeader(key string) string {
	parts := strings.Split(key, "-")
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, "-")
}
