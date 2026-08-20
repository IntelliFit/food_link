package migration

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTangshanDirectoryCorrectionCandidatesAreExactAndUnique(t *testing.T) {
	assert.Equal(t, "唐山高校官方食堂楼层确认集-20260816", tangshanRejectedDiningBatchName)
	assert.Len(t, tangshanDirectoryCandidates, 3)
	seen := map[string]struct{}{}
	for _, candidate := range tangshanDirectoryCandidates {
		assert.NotEmpty(t, candidate.School)
		assert.NotEmpty(t, candidate.Campus)
		assert.NotEmpty(t, candidate.Canteen)
		key := tangshanDirectoryCandidateKey(candidate)
		if _, exists := seen[key]; exists {
			t.Fatalf("duplicate Tangshan correction candidate %q", key)
		}
		seen[key] = struct{}{}
	}
}
