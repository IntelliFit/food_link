package service

import (
	"context"
	"errors"
	"testing"

	"food_link/backend/internal/researchweight/domain"

	"github.com/stretchr/testify/require"
)

type fakeVision struct {
	model string
	reply map[string]any
	err   error
	calls int
}

func (f *fakeVision) AnalyzeWithImagesAndTemperatureMeta(_ context.Context, _ string, _ []string, _ float64) (map[string]any, map[string]any, error) {
	f.calls++
	if f.err != nil {
		return nil, nil, f.err
	}
	return f.reply, map[string]any{"model": f.model}, nil
}

func display(value, unit string) map[string]any {
	return map[string]any{"is_scale_display": true, "readable": true, "value": value, "unit": unit}
}

func TestParseScaleReadingConvertsUnitsToGrams(t *testing.T) {
	cases := []struct {
		name       string
		raw        map[string]any
		grams      float64
		resolution float64
	}{
		{"grams", display("452", "g"), 452, 1},
		{"tenth grams", display("452.3", "g"), 452.3, 0.1},
		{"kilograms keep the display step", display("0.45", "kg"), 450, 10},
		{"jin", display("0.9", "jin"), 450, 50},
		{"ounces", display("16.0", "oz"), 453.6, 2.8349523125},
		{"pounds and ounces", map[string]any{"is_scale_display": true, "readable": true, "unit": "lb_oz", "pounds": 1.0, "ounces": 3.5}, 552.8, 2.8},
		{"numeric value from the model", map[string]any{"is_scale_display": true, "readable": true, "value": 300.0, "unit": "g"}, 300, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reading := ParseScaleReading(tc.raw)
			require.True(t, reading.Readable)
			require.NotNil(t, reading.Grams)
			require.InDelta(t, tc.grams, *reading.Grams, 0.05)
			require.InDelta(t, tc.resolution, reading.ResolutionGrams, 0.01)
		})
	}
}

func TestParseScaleReadingRefusesWhatIsNotAWeight(t *testing.T) {
	for name, raw := range map[string]map[string]any{
		"liquid mode":        display("250", "ml"),
		"unknown unit":       display("250", "unknown"),
		"negative reading":   {"is_scale_display": true, "readable": true, "value": "12", "unit": "g", "negative": true},
		"not a scale":        {"is_scale_display": false, "readable": true, "value": "12", "unit": "g"},
		"model says blurry":  {"is_scale_display": true, "readable": false, "reason": "反光"},
		"garbled digits":     display("4S2", "g"),
		"missing lb ounces":  {"is_scale_display": true, "readable": true, "unit": "lb_oz", "pounds": 1.0},
		"empty value string": display("", "g"),
	} {
		t.Run(name, func(t *testing.T) {
			reading := ParseScaleReading(raw)
			require.False(t, reading.Readable)
			require.Nil(t, reading.Grams)
		})
	}
}

func TestReadingAgreementComparesWithinTheDisplayStep(t *testing.T) {
	g := func(value, unit string) domain.ScaleReading { return ParseScaleReading(display(value, unit)) }
	agreement, chosen := ReadingAgreement([]domain.ScaleReading{g("450", "g"), g("0.45", "kg")}, 1)
	require.Equal(t, domain.AgreementAgree, agreement)
	require.InDelta(t, 450, *chosen.Grams, 0.01)

	agreement, _ = ReadingAgreement([]domain.ScaleReading{g("450", "g"), g("480", "g")}, 1)
	require.Equal(t, domain.AgreementDisagree, agreement)

	agreement, chosen = ReadingAgreement([]domain.ScaleReading{{Error: "timeout"}, g("312", "g")}, 1)
	require.Equal(t, domain.AgreementSingle, agreement)
	require.InDelta(t, 312, *chosen.Grams, 0.01)

	agreement, chosen = ReadingAgreement([]domain.ScaleReading{{}, {}}, 1)
	require.Equal(t, domain.AgreementUnreadable, agreement)
	require.Nil(t, chosen)
}

func TestScaleReaderAsksBothModelsAndKeepsFailures(t *testing.T) {
	primary := &fakeVision{model: "gemini", reply: display("452", "g")}
	verifier := &fakeVision{model: "qwen", err: errors.New("upstream timeout")}
	readings := NewScaleReader(primary, verifier).Read(context.Background(), "https://cdn.test/a.jpg")
	require.Len(t, readings, 2)
	require.Equal(t, "gemini", readings[0].Model)
	require.True(t, readings[0].Readable)
	require.False(t, readings[1].Readable)
	require.Contains(t, readings[1].Error, "timeout")
	require.Equal(t, 1, primary.calls)
	require.Equal(t, 1, verifier.calls)
}

func TestNewScaleReaderNeedsAtLeastOneModel(t *testing.T) {
	require.Nil(t, NewScaleReader(nil, nil))
	only := &fakeVision{reply: display("10", "g")}
	reader := NewScaleReader(nil, only)
	require.NotNil(t, reader)
	require.Len(t, reader.Read(context.Background(), "u"), 1)
}
