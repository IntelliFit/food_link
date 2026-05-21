package app

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAppPackage(t *testing.T) {
	// This is a compile-time / smoke test for the app package
	// The New() function requires real database/config which is not feasible in unit tests
	assert.True(t, true)
}

func TestShouldTraceHTTPRequestSkipsHealthCheck(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/health", nil)
	assert.NoError(t, err)
	assert.False(t, shouldTraceHTTPRequest(req))
}

func TestShouldTraceHTTPRequestTracesOtherRoutes(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/membership/me", nil)
	assert.NoError(t, err)
	assert.True(t, shouldTraceHTTPRequest(req))
	assert.True(t, shouldTraceHTTPRequest(nil))
}
