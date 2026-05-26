package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCustomHealthFocusesExport(t *testing.T) {
	raw := []map[string]any{
		{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
	}
	focuses := ParseCustomHealthFocusesExport(raw)
	require.Len(t, focuses, 1)
	assert.Equal(t, "f1", focuses[0].ID)
	assert.Equal(t, "控尿酸", focuses[0].Label)
}

func TestNormalizeCustomHealthFocusLabel(t *testing.T) {
	label, err := normalizeCustomHealthFocusLabel("控尿酸")
	require.NoError(t, err)
	assert.Equal(t, "控尿酸", label)

	_, err = normalizeCustomHealthFocusLabel("A")
	require.Error(t, err)
}
