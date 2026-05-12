//go:build food_analysis_load

package loadtest

import "testing"

func TestFoodAnalysisStabilityAndLatencyQwen(t *testing.T) {
	runFoodAnalysisLoadTest(t, "qwen")
}
