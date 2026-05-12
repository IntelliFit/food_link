package routes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromRouteMap(t *testing.T) {
	specs, err := LoadFromRouteMap("../../../docs/backend-api-prd/ROUTE_MAP.md")
	if err != nil {
		t.Fatalf("load route map: %v", err)
	}
	if len(specs) != 143 {
		t.Fatalf("unexpected route count: got %d want 143", len(specs))
	}
}

func TestLoadFromRouteMap_FileNotFound(t *testing.T) {
	_, err := LoadFromRouteMap("/nonexistent/path/route_map.md")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no such file")
}

func TestLoadFromRouteMap_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "empty.md")
	require.NoError(t, os.WriteFile(tmpFile, []byte("# Empty\n"), 0644))

	_, err := LoadFromRouteMap(tmpFile)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no route specs found")
}

func TestLoadFromRouteMap_ValidContent(t *testing.T) {
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "routes.md")
	content := "| Method | Path | Module | Auth | AuthType | DocRef |\n" +
		"|--------|------|--------|------|----------|--------|\n" +
		"| `GET` | `/api/test` | test | `jwt_required` | miniapp-used | doc1 |\n" +
		"| `POST` | `/api/test` | test | `jwt_optional` | backend-only | doc2 |\n"

	require.NoError(t, os.WriteFile(tmpFile, []byte(content), 0644))

	specs, err := LoadFromRouteMap(tmpFile)
	require.NoError(t, err)
	require.Len(t, specs, 2)
	assert.Equal(t, "GET", specs[0].Method)
	assert.Equal(t, "/api/test", specs[0].Path)
	assert.Equal(t, "jwt_required", specs[0].Auth)
	assert.Equal(t, "doc1", specs[0].DocRef)
	assert.Equal(t, "POST", specs[1].Method)
	assert.Equal(t, "jwt_optional", specs[1].Auth)
}
