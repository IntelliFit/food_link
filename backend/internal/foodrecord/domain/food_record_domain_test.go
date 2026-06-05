package domain

import (
	"encoding/json"
	"testing"
)

func TestFoodItemUnmarshalJSON_ClampsRatioAndIntake(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		expectRatio  float64
		expectIntake float64
	}{
		{
			name:         "intake exceeding weight clamps ratio to 100",
			input:        `{"weight":200,"intake":250}`,
			expectRatio:  100,
			expectIntake: 200,
		},
		{
			name:         "ratio over 100 is clamped",
			input:        `{"weight":200,"ratio":120,"intake":200}`,
			expectRatio:  100,
			expectIntake: 200,
		},
		{
			name:         "normal ratio and intake preserved",
			input:        `{"weight":200,"ratio":50,"intake":100}`,
			expectRatio:  50,
			expectIntake: 100,
		},
		{
			name:         "ratio exactly 100 preserved",
			input:        `{"weight":281.6,"ratio":100.2,"intake":282.2}`,
			expectRatio:  100,
			expectIntake: 281.6,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var item FoodItem
			if err := json.Unmarshal([]byte(tt.input), &item); err != nil {
				t.Fatalf("unmarshal failed: %v", err)
			}
			if item.Ratio != tt.expectRatio {
				t.Errorf("Ratio: expected %v, got %v", tt.expectRatio, item.Ratio)
			}
			if item.Intake != tt.expectIntake {
				t.Errorf("Intake: expected %v, got %v", tt.expectIntake, item.Intake)
			}
		})
	}
}
