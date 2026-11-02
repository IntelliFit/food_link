package service

import "strings"

const (
	analysisEngineAIDirect      = "ai_direct"
	analysisEngineAIThenDBExact = "ai_then_db_exact"
	analysisEngineDBCandidates  = "db_candidates_ai"
	analysisEngineLegacyDirect  = "legacy_direct"
	analysisEngineLegacyDBFirst = "db_first"
	// analysisEngineSmart looks every item up in the library that fits its kind
	// (packaged, single food, or a dish split into ingredients) and keeps the
	// model's own estimate whenever no unambiguous match exists.
	analysisEngineSmart = "smart"
)

func normalizeAnalysisEngine(engine, executionMode string, textInput bool) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case analysisEngineAIDirect, analysisEngineAIThenDBExact, analysisEngineDBCandidates,
		analysisEngineLegacyDirect, analysisEngineLegacyDBFirst, analysisEngineSmart:
		return strings.ToLower(strings.TrimSpace(engine))
	case "auto", "hybrid":
		return analysisEngineSmart
	case "direct", "ai":
		return analysisEngineAIDirect
	case "calibrated", "exact_db":
		return analysisEngineAIThenDBExact
	case "candidate", "candidate_guided":
		return analysisEngineDBCandidates
	}

	if textInput {
		return analysisEngineAIDirect
	}
	if isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode) {
		return analysisEngineDBCandidates
	}
	return analysisEngineAIDirect
}

func analysisEngineProducesNutrition(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case analysisEngineAIDirect, analysisEngineAIThenDBExact, analysisEngineDBCandidates, analysisEngineLegacyDirect, analysisEngineSmart:
		return true
	default:
		return false
	}
}
