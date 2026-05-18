//go:build food_analysis_load

package loadtest

import "testing"

func TestFoodAnalysisStabilityAndLatencyDoubao(t *testing.T) {
	runFoodAnalysisLoadTest(t, "doubao")
}
