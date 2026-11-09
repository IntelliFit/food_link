package service

import (
	"context"
	"sync"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"github.com/stretchr/testify/require"
)

type capturingLibrary struct {
	*smartLibrary
	mu       sync.Mutex
	captured []foodrecordrepo.PackagedFoodInput
}

func (l *capturingLibrary) CapturePackagedFoodIfAbsent(_ context.Context, input foodrecordrepo.PackagedFoodInput) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.captured = append(l.captured, input)
	return true, nil
}

func withInlineLabelCapture(t *testing.T) {
	t.Helper()
	previous := smartRunLabelCapture
	smartRunLabelCapture = func(work func()) { work() }
	t.Cleanup(func() { smartRunLabelCapture = previous })
}

var colaPanel = map[string]any{"calories": 43.0, "protein": 0.0, "fat": 0.0, "carbs": 10.6}

func TestSmartLabelCaptureNeedsBrandNameAndAConsistentPanel(t *testing.T) {
	item := map[string]any{"name": "某品牌柠檬茶"}
	capture, ok := smartLabelCaptureFrom(item, smartPackageReading{brand: "某品牌", product: "柠檬茶", unit: "ml", net: 500, label: colaPanel})
	require.True(t, ok)
	require.Equal(t, "柠檬茶", capture.product)

	_, ok = smartLabelCaptureFrom(item, smartPackageReading{product: "柠檬茶", label: colaPanel})
	require.False(t, ok, "no brand, no row")
	_, ok = smartLabelCaptureFrom(item, smartPackageReading{brand: "某品牌", product: "柠檬茶"})
	require.False(t, ok, "no panel")
	_, ok = smartLabelCaptureFrom(item, smartPackageReading{brand: "某品牌", product: "柠檬茶",
		label: map[string]any{"calories": 400.0, "protein": 1.0, "fat": 1.0, "carbs": 10.0}})
	require.False(t, ok, "energy that the macros cannot explain is a misread")

	// A panel the main call already read counts too; the name gives the product.
	labelled := map[string]any{"name": "某品牌柠檬茶", "ingredients": map[string]any{"nutritionPer100g": colaPanel}}
	capture, ok = smartLabelCaptureFrom(labelled, smartPackageReading{brand: "某品牌"})
	require.True(t, ok)
	require.Equal(t, "柠檬茶", capture.product)
}

func TestSmartCapturesANewProductButNotAKnownOne(t *testing.T) {
	withInlineLabelCapture(t)
	library := &capturingLibrary{smartLibrary: newSmartLibrary()}
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "known", Brand: "可口可乐", ProductName: "可口可乐 汽水", DisplayName: "可口可乐 汽水 330ml", KcalPer100g: 43, IsActive: true},
	}
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureNutritionResolver(library)
	ctx := WithVisionRequest(context.Background(), "standard", "task-1", false)

	s.captureSmartLabels(ctx, []smartLabelCapture{
		{brand: "可口可乐", product: "汽水", label: colaPanel},
		{brand: "某品牌", product: "柠檬茶", unit: "ml", net: 500, label: colaPanel},
	})

	require.Len(t, library.captured, 1, "the library already matches 可口可乐 汽水")
	got := library.captured[0]
	require.Equal(t, "某品牌", got.Brand)
	require.Equal(t, "柠檬茶", got.ProductName)
	require.Equal(t, smartLabelCaptureSource, got.Source)
	require.Equal(t, "active", got.ReviewStatus)
	require.Equal(t, "100ml", got.NutritionBasisUnit)
	require.InDelta(t, 500, got.NetWeightG, 0.01)
	require.InDelta(t, 43, got.KcalPer100g, 0.01)
	require.Equal(t, "task-1", got.RawLabelPayload["task_id"])
	require.Empty(t, got.SourceImageURLs, "the user's photo is never stored with a library row")
}
