package e2e

import (
	"fmt"
	"sort"
	"strings"
)

func materializeCase(input Case, vars map[string]string) Case {
	c := input
	c.Path = replaceVars(c.Path, vars)
	c.Query = replaceStringMap(c.Query, vars)
	c.Headers = replaceStringMap(c.Headers, vars)
	c.Body = replaceAny(c.Body, vars)
	if c.Expect.Headers != nil {
		c.Expect.Headers = replaceAny(c.Expect.Headers, vars).(map[string]any)
	}
	if c.Expect.JSON != nil {
		c.Expect.JSON = replaceAny(c.Expect.JSON, vars).(map[string]any)
	}
	c.Expect.JSONSchema = replaceAny(c.Expect.JSONSchema, vars)
	c.Expect.BodyContains = replaceStringSlice(c.Expect.BodyContains, vars)
	return c
}

func materializeDBAssert(input DBAssert, vars map[string]string) DBAssert {
	out := input
	out.Query = replaceVars(out.Query, vars)
	if input.Args != nil {
		out.Args = replaceAny(input.Args, vars).([]any)
	}
	out.Equals = replaceAny(input.Equals, vars)
	return out
}

func replaceStringMap(input map[string]string, vars map[string]string) map[string]string {
	if input == nil {
		return nil
	}
	out := make(map[string]string, len(input))
	for k, v := range input {
		out[replaceVars(k, vars)] = replaceVars(v, vars)
	}
	return out
}

func replaceStringSlice(input []string, vars map[string]string) []string {
	if input == nil {
		return nil
	}
	out := make([]string, len(input))
	for i, v := range input {
		out[i] = replaceVars(v, vars)
	}
	return out
}

func replaceAny(input any, vars map[string]string) any {
	switch value := input.(type) {
	case nil:
		return nil
	case string:
		return replaceVars(value, vars)
	case map[string]any:
		out := make(map[string]any, len(value))
		for k, v := range value {
			out[replaceVars(k, vars)] = replaceAny(v, vars)
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(value))
		for k, v := range value {
			out[replaceVars(fmt.Sprint(k), vars)] = replaceAny(v, vars)
		}
		return out
	case []any:
		out := make([]any, len(value))
		for i, v := range value {
			out[i] = replaceAny(v, vars)
		}
		return out
	default:
		return input
	}
}

func unresolvedVars(value string) []string {
	matches := varPattern.FindAllStringSubmatch(value, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) == 2 {
			out = append(out, strings.TrimSpace(match[1]))
		}
	}
	return out
}

func caseRequestUnresolvedVars(c Case) []string {
	found := map[string]bool{}
	addString := func(value string) {
		for _, name := range unresolvedVars(value) {
			found[name] = true
		}
	}
	addAny := func(value any) {}
	addAny = func(value any) {
		switch v := value.(type) {
		case nil:
			return
		case string:
			addString(v)
		case map[string]any:
			for k, item := range v {
				addString(k)
				addAny(item)
			}
		case map[any]any:
			for k, item := range v {
				addString(fmt.Sprint(k))
				addAny(item)
			}
		case []any:
			for _, item := range v {
				addAny(item)
			}
		case []string:
			for _, item := range v {
				addString(item)
			}
		case map[string]string:
			for k, item := range v {
				addString(k)
				addString(item)
			}
		}
	}

	addString(c.Path)
	addAny(c.Query)
	addAny(c.Headers)
	addAny(c.Body)
	addAny(c.Expect.Headers)
	addAny(c.Expect.JSON)
	addAny(c.Expect.JSONSchema)
	addAny(c.Expect.BodyContains)

	out := make([]string, 0, len(found))
	for name := range found {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func dbAssertUnresolvedVars(assertion DBAssert) []string {
	found := map[string]bool{}
	addString := func(value string) {
		for _, name := range unresolvedVars(value) {
			found[name] = true
		}
	}
	var addAny func(value any)
	addAny = func(value any) {
		switch v := value.(type) {
		case nil:
			return
		case string:
			addString(v)
		case map[string]any:
			for k, item := range v {
				addString(k)
				addAny(item)
			}
		case map[any]any:
			for k, item := range v {
				addString(fmt.Sprint(k))
				addAny(item)
			}
		case []any:
			for _, item := range v {
				addAny(item)
			}
		case []string:
			for _, item := range v {
				addString(item)
			}
		case map[string]string:
			for k, item := range v {
				addString(k)
				addString(item)
			}
		}
	}

	addString(assertion.Query)
	addAny(assertion.Args)
	addAny(assertion.Equals)

	out := make([]string, 0, len(found))
	for name := range found {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
