package service

import (
	"math"
	"testing"
)

func TestCalculateBMR(t *testing.T) {
	cases := []struct {
		gender   string
		weight   float64
		expected float64
	}{
		{"male", 70, (48.5*70 + 2954.7) / 4.184},
		{"female", 55, (41.9*55 + 2869.1) / 4.184},
		{"male", 60, (48.5*60 + 2954.7) / 4.184},
		{"female", 50, (41.9*50 + 2869.1) / 4.184},
	}
	for _, c := range cases {
		got := CalculateBMR(c.gender, c.weight)
		if math.Abs(got-c.expected) > 0.01 {
			t.Errorf("CalculateBMR(%s, %f) = %f, want %f", c.gender, c.weight, got, c.expected)
		}
	}
}

func TestCalculateTDEE(t *testing.T) {
	bmr := 1500.0
	cases := []struct {
		activity string
		expected float64
	}{
		{"sedentary", 1500 * 1.2},
		{"light", 1500 * 1.375},
		{"moderate", 1500 * 1.55},
		{"active", 1500 * 1.725},
		{"very_active", 1500 * 1.9},
		{"unknown", 1500 * 1.2},
	}
	for _, c := range cases {
		got := CalculateTDEE(bmr, c.activity)
		if math.Abs(got-c.expected) > 0.01 {
			t.Errorf("CalculateTDEE(%f, %s) = %f, want %f", bmr, c.activity, got, c.expected)
		}
	}
}
