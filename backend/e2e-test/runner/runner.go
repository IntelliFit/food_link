package e2e

import (
	"context"
	"fmt"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/app"
	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"

	"github.com/gavv/httpexpect/v2"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Options struct {
	SuitePath string
	ConfigDir string
	CaseID    string
	Group     string
	List      bool
	KeepDB    bool
}

type Result struct {
	Suite       string
	SuiteName   string
	SuiteDesc   string
	TempDBName  string
	Total       int
	Passed      int
	Failed      int
	Failures    []caseFailure
	CaseResults []CaseResult
}

type CaseResult struct {
	ID     string
	Name   string
	Desc   string
	Group  string
	Method string
	Path   string
	Passed bool
}

func Run(ctx context.Context, opts Options) (*Result, error) {
	suite, err := LoadSuite(opts.SuitePath)
	if err != nil {
		return nil, err
	}
	if opts.ConfigDir != "" {
		suite.ConfigDir = opts.ConfigDir
	}
	if opts.KeepDB {
		suite.TempDB.Keep = true
	}
	if opts.List {
		cases := filterCases(suite.Cases, opts.CaseID, opts.Group)
		for _, c := range cases {
			fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\n", c.caseID(), c.Name, c.Desc, c.Group, strings.ToUpper(c.Method), c.Path)
		}
		if suite.RouteSmoke.Enabled && (opts.Group == "" || opts.Group == suite.RouteSmoke.Group) && opts.CaseID == "" {
			fmt.Printf("(route smoke enabled; generated route cases are listed when the suite is run)\n")
		}
		return &Result{Suite: suite.ID, SuiteName: suite.Name, SuiteDesc: suite.Desc, Total: len(cases)}, nil
	}

	cfg, err := config.Load(suite.ConfigDir)
	if err != nil {
		return nil, fmt.Errorf("load backend config: %w", err)
	}
	cfg.App.Env = "test"
	cfg.OTel.Enabled = false
	cfg.Worker.Count = 0
	cfg.TaskQueue.Driver = "memory"
	if cfg.JWT.Secret == "" {
		cfg.JWT.Secret = "api-contract-test-secret"
	}

	tempDB, err := PrepareDatabase(ctx, suite, cfg)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err == nil {
			_ = tempDB.Close(context.Background())
		}
	}()
	cfg.Database = tempDB.Config

	vars := suiteVars(suite)
	if err := ApplySeedSQL(ctx, suite, tempDB.DB(), vars); err != nil {
		return nil, err
	}

	gin.SetMode(gin.TestMode)
	application, err := app.New(cfg)
	if err != nil {
		return nil, err
	}
	defer application.Close(context.Background())

	cases := expandCases(suite, application.Engine())
	cases = filterCases(cases, opts.CaseID, opts.Group)

	result := &Result{Suite: suite.ID, SuiteName: suite.Name, SuiteDesc: suite.Desc, TempDBName: tempDB.Name}
	for _, c := range cases {
		caseResult, failures := runCase(ctx, suite, cfg, tempDB.DB(), application.Engine(), c, vars)
		result.Total++
		result.CaseResults = append(result.CaseResults, caseResult)
		if len(failures) == 0 {
			result.Passed++
		} else {
			result.Failed++
			result.Failures = append(result.Failures, failures...)
		}
	}
	return result, nil
}

func runCase(ctx context.Context, suite *Suite, cfg *config.Config, db *gorm.DB, engine http.Handler, input Case, vars map[string]string) (CaseResult, []caseFailure) {
	c := materializeCase(input, vars)
	caseID := c.caseID()
	if names := caseRequestUnresolvedVars(c); len(names) > 0 {
		return CaseResult{
				ID:     caseID,
				Name:   c.Name,
				Desc:   c.Desc,
				Group:  c.Group,
				Method: strings.ToUpper(c.Method),
				Path:   c.Path,
				Passed: false,
			}, []caseFailure{{
				Case:    caseID,
				Message: fmt.Sprintf("unresolved variable(s): %s; define them in default_vars/auth users or create them in an earlier capture step", strings.Join(names, ", ")),
			}}
	}
	reporter := &caseReporter{caseName: caseID}
	expect := httpexpect.WithConfig(httpexpect.Config{
		TestName: caseID,
		BaseURL:  "http://api-contract.local",
		Client: &http.Client{
			Transport: httpexpect.NewBinder(engine),
			Timeout:   20 * time.Second,
		},
		Context:  ctx,
		Reporter: reporter,
	})

	req := expect.Request(strings.ToUpper(c.Method), c.Path)
	for k, v := range c.Query {
		req.WithQuery(k, v)
	}
	for k, v := range c.Headers {
		req.WithHeader(k, v)
	}
	authFailure := applyAuth(req, suite, cfg, c.Auth)
	if c.Body != nil {
		req.WithJSON(c.Body)
	}

	resp := req.Expect()
	if len(c.Expect.StatusAny) > 0 {
		resp.StatusList(c.Expect.StatusAny...)
	} else if c.Expect.Status != 0 {
		resp.Status(c.Expect.Status)
	}
	if c.Expect.JSONSchema != nil {
		resp.JSON().Schema(c.Expect.JSONSchema)
	}
	body := resp.Body().Raw()
	failures := append([]caseFailure{}, reporter.failures...)
	if authFailure != nil {
		authFailure.Case = caseID
		failures = append(failures, *authFailure)
	}
	if len(c.Expect.Headers) > 0 {
		failures = append(failures, assertHeaders(caseID, resp.Raw().Header, c.Expect.Headers)...)
	}
	if len(c.Expect.JSON) > 0 {
		failures = append(failures, assertJSON(caseID, body, c.Expect.JSON)...)
	}
	if len(c.Expect.BodyContains) > 0 {
		failures = append(failures, assertBodyContains(caseID, body, c.Expect.BodyContains)...)
	}
	if c.Expect.BodyNotEmpty && strings.TrimSpace(body) == "" {
		failures = append(failures, caseFailure{Case: caseID, Message: "expected non-empty body"})
	}
	if len(c.Capture) > 0 {
		failures = append(failures, captureJSON(caseID, body, c.Capture, vars)...)
	}
	if len(c.DBAssert) > 0 {
		failures = append(failures, assertDatabase(ctx, db, caseID, c.DBAssert, vars)...)
	}

	return CaseResult{
		ID:     caseID,
		Name:   c.Name,
		Desc:   c.Desc,
		Group:  c.Group,
		Method: strings.ToUpper(c.Method),
		Path:   c.Path,
		Passed: len(failures) == 0,
	}, failures
}

func applyAuth(req *httpexpect.Request, suite *Suite, cfg *config.Config, authName string) *caseFailure {
	authName = strings.TrimSpace(authName)
	switch authName {
	case "", "none":
		return nil
	case "test_backend_cookie":
		token := suite.Auth.TestBackendCookie
		if token == "" {
			token = "api-contract-test"
		}
		req.WithCookie("test_backend_token", token)
		return nil
	default:
		user, ok := suite.Auth.Users[authName]
		if !ok {
			return &caseFailure{Message: fmt.Sprintf("unknown auth profile %q", authName)}
		}
		jwtSvc := authservice.NewJWTService(cfg.JWT.Secret, cfg.JWT.AccessTokenTTLSeconds, cfg.JWT.RefreshTokenTTLSeconds)
		token, err := jwtSvc.IssueAccess(user.ID, user.OpenID, user.UnionID)
		if err != nil {
			return &caseFailure{Message: fmt.Sprintf("issue auth token for %q: %v", authName, err)}
		}
		req.WithHeader("Authorization", "Bearer "+token)
		return nil
	}
}

func filterCases(cases []Case, caseID, group string) []Case {
	if caseID == "" && group == "" {
		return cases
	}
	out := []Case{}
	for _, c := range cases {
		if caseID != "" && c.caseID() != caseID {
			continue
		}
		if group != "" && c.Group != group {
			continue
		}
		out = append(out, c)
	}
	return out
}

func expandCases(suite *Suite, engine *gin.Engine) []Case {
	cases := append([]Case{}, suite.Cases...)
	if !suite.RouteSmoke.Enabled {
		return cases
	}
	excluded := map[string]bool{}
	for _, item := range suite.RouteSmoke.Exclude {
		excluded[item] = true
	}
	routes := engine.Routes()
	sort.Slice(routes, func(i, j int) bool {
		a := routes[i].Method + " " + routes[i].Path
		b := routes[j].Method + " " + routes[j].Path
		return a < b
	})
	for _, route := range routes {
		key := route.Method + " " + route.Path
		if excluded[key] || excluded[route.Path] || matchesExclude(route.Path, suite.RouteSmoke.Exclude) || matchesExclude(key, suite.RouteSmoke.Exclude) {
			continue
		}
		if len(suite.RouteSmoke.IncludePrefix) > 0 && !hasAnyPrefix(route.Path, suite.RouteSmoke.IncludePrefix) {
			continue
		}
		body := suite.RouteSmoke.Body
		if body == nil && methodUsuallyHasBody(route.Method) {
			body = map[string]any{}
		}
		cases = append(cases, Case{
			ID:     "route-smoke." + route.Method + "." + sanitizeName(route.Path),
			Name:   routeSmokeName(route.Method, route.Path),
			Desc:   fmt.Sprintf("自动生成的路由冒烟用例：请求 %s %s，验证路由不会 panic，状态码在允许列表内，并返回 X-Trace-Id。", route.Method, route.Path),
			Group:  suite.RouteSmoke.Group,
			Method: route.Method,
			Path:   materializeRoutePath(route.Path, suite.RouteSmoke.PathParams),
			Query:  suite.RouteSmoke.Query,
			Auth:   suite.RouteSmoke.Auth,
			Body:   body,
			Expect: Expect{
				StatusAny: suite.RouteSmoke.ExpectStatus,
				Headers: map[string]any{
					"X-Trace-Id": "not_empty",
				},
			},
		})
	}
	return cases
}

func materializeRoutePath(routePath string, params map[string]string) string {
	parts := strings.Split(routePath, "/")
	for i, part := range parts {
		if strings.HasPrefix(part, ":") {
			key := strings.TrimPrefix(part, ":")
			value := params[key]
			if value == "" {
				value = "00000000-0000-0000-0000-000000000001"
			}
			parts[i] = value
		}
	}
	return path.Clean(strings.Join(parts, "/"))
}

func methodUsuallyHasBody(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	default:
		return false
	}
}

func hasAnyPrefix(value string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

func matchesExclude(value string, patterns []string) bool {
	for _, pattern := range patterns {
		if strings.HasSuffix(pattern, "*") && strings.HasPrefix(value, strings.TrimSuffix(pattern, "*")) {
			return true
		}
	}
	return false
}

func routeSmokeName(method, routePath string) string {
	return fmt.Sprintf("路由冒烟 %s %s", method, routePath)
}

func sanitizeName(value string) string {
	value = strings.Trim(value, "/")
	if value == "" {
		return "root"
	}
	replacer := strings.NewReplacer("/", ".", ":", "", "-", "_")
	return replacer.Replace(value)
}
