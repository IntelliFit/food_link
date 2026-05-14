package e2e

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Suite struct {
	Name        string            `yaml:"name"`
	ConfigDir   string            `yaml:"config_dir"`
	TempDB      TempDBConfig      `yaml:"temp_db"`
	Auth        AuthConfig        `yaml:"auth"`
	SeedSQL     []string          `yaml:"seed_sql"`
	RouteSmoke  RouteSmokeConfig  `yaml:"route_smoke"`
	DefaultVars map[string]string `yaml:"default_vars"`
	Cases       []Case            `yaml:"cases"`

	path string
}

type TempDBConfig struct {
	Enabled       *bool  `yaml:"enabled"`
	AdminDatabase string `yaml:"admin_database"`
	Keep          bool   `yaml:"keep"`
	NamePrefix    string `yaml:"name_prefix"`
}

type AuthConfig struct {
	Users             map[string]AuthUser `yaml:"users"`
	TestBackendCookie string              `yaml:"test_backend_cookie"`
}

type AuthUser struct {
	ID      string `yaml:"id"`
	OpenID  string `yaml:"openid"`
	UnionID string `yaml:"unionid"`
}

type RouteSmokeConfig struct {
	Enabled       bool              `yaml:"enabled"`
	Group         string            `yaml:"group"`
	Auth          string            `yaml:"auth"`
	PathParams    map[string]string `yaml:"path_params"`
	Query         map[string]string `yaml:"query"`
	Body          any               `yaml:"body"`
	ExpectStatus  []int             `yaml:"expect_status"`
	Exclude       []string          `yaml:"exclude"`
	IncludePrefix []string          `yaml:"include_prefix"`
}

type Case struct {
	Name    string            `yaml:"name"`
	Group   string            `yaml:"group"`
	Method  string            `yaml:"method"`
	Path    string            `yaml:"path"`
	Query   map[string]string `yaml:"query"`
	Headers map[string]string `yaml:"headers"`
	Auth    string            `yaml:"auth"`
	Body    any               `yaml:"body"`
	Expect  Expect            `yaml:"expect"`
}

type Expect struct {
	Status       int            `yaml:"status"`
	StatusAny    []int          `yaml:"status_any"`
	Headers      map[string]any `yaml:"headers"`
	JSON         map[string]any `yaml:"json"`
	JSONSchema   any            `yaml:"json_schema"`
	BodyContains []string       `yaml:"body_contains"`
	BodyNotEmpty bool           `yaml:"body_not_empty"`
}

func LoadSuite(path string) (*Suite, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var suite Suite
	if err := yaml.Unmarshal(data, &suite); err != nil {
		return nil, err
	}
	suite.path = path
	if suite.Name == "" {
		suite.Name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if suite.ConfigDir == "" {
		suite.ConfigDir = "."
	}
	if suite.TempDB.Enabled == nil {
		enabled := true
		suite.TempDB.Enabled = &enabled
	}
	if suite.TempDB.AdminDatabase == "" {
		suite.TempDB.AdminDatabase = "postgres"
	}
	if suite.TempDB.NamePrefix == "" {
		suite.TempDB.NamePrefix = "food_link_e2e"
	}
	if suite.RouteSmoke.Group == "" {
		suite.RouteSmoke.Group = "route-smoke"
	}
	if len(suite.RouteSmoke.ExpectStatus) == 0 {
		suite.RouteSmoke.ExpectStatus = []int{200, 201, 202, 204, 302, 400, 401, 403, 404, 405}
	}
	if suite.DefaultVars == nil {
		suite.DefaultVars = map[string]string{}
	}
	if err := suite.validate(); err != nil {
		return nil, err
	}
	return &suite, nil
}

func (s *Suite) validate() error {
	seen := map[string]bool{}
	for i, c := range s.Cases {
		if c.Name == "" {
			return fmt.Errorf("cases[%d].name is required", i)
		}
		if seen[c.Name] {
			return fmt.Errorf("duplicate case name %q", c.Name)
		}
		seen[c.Name] = true
		if c.Method == "" {
			return fmt.Errorf("case %q method is required", c.Name)
		}
		if c.Path == "" {
			return fmt.Errorf("case %q path is required", c.Name)
		}
	}
	return nil
}

func (s *Suite) baseDir() string {
	if s.path == "" {
		return "."
	}
	return filepath.Dir(s.path)
}

func (s *Suite) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(s.baseDir(), path)
}
