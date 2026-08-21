package service

import "strings"

const (
	analysisEngineAIDirect      = "ai_direct"
	analysisEngineAIThenDBExact = "ai_then_db_exact"
	analysisEngineDBCandidates  = "db_candidates_ai"
	analysisEngineLegacyDirect  = "legacy_direct"
	analysisEngineLegacyDBFirst = "db_first"
)

func normalizeAnalysisEngine(engine, executionMode string, textInput bool) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case analysisEngineAIDirect, analysisEngineAIThenDBExact, analysisEngineDBCandidates,
		analysisEngineLegacyDirect, analysisEngineLegacyDBFirst:
		return strings.ToLower(strings.TrimSpace(engine))
	case "direct", "ai":
		return analysisEngineAIDirect
	case "calibrated", "exact_db":
		return analysisEngineAIThenDBExact
	case "candidate", "candidate_guided":
		return analysisEngineDBCandidates
	}

	if textInput || isFastExecutionMode(executionMode) {
		return analysisEngineAIDirect
	}
	if isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode) {
		return analysisEngineDBCandidates
	}
	return analysisEngineAIThenDBExact
}

func analysisEngineProducesNutrition(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case analysisEngineAIDirect, analysisEngineAIThenDBExact, analysisEngineDBCandidates, analysisEngineLegacyDirect:
		return true
	default:
		return false
	}
}
