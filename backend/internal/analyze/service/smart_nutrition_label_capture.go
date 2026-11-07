package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
)

// A nutrition panel that happens to be in a meal photo is added to the
// packaged library on its own, so the next photo of the same product matches
// at once. Users are never asked to photograph a label. Only a complete,
// self-consistent panel of a product with a read brand and name is kept, a
// product the library already has is left alone, and the user's photo is not
// stored with the row.
const (
	smartLabelCaptureSource  = "photo_label_auto"
	smartLabelCaptureIngest  = "photo_package_read"
	smartLabelCaptureTimeout = 10 * time.Second
)

type packagedFoodCapturer interface {
	CapturePackagedFoodIfAbsent(ctx context.Context, input foodrecordrepo.PackagedFoodInput) (bool, error)
}

// smartRunLabelCapture runs the capture off the request path; tests replace it
// to run inline.
var smartRunLabelCapture = func(work func()) { go work() }

type smartLabelCapture struct {
	brand, product, flavor, unit, evidence string
	net                                    float64
	label                                  map[string]any
}

// smartLabelCaptureFrom takes the panel the package read found, or the one the
// main call read, for an item whose brand and product name are known.
func smartLabelCaptureFrom(item map[string]any, reading smartPackageReading) (smartLabelCapture, bool) {
	label := reading.label
	if label == nil {
		label = ingredientLabelNutritionFromItem(item)
	}
	if !smartLabelConsistent(label) {
		return smartLabelCapture{}, false
	}
	product := strings.TrimSpace(reading.product)
	if product == "" && reading.brand != "" {
		product = strings.TrimSpace(strings.Replace(stringFromAny(item["name"]), reading.brand, "", 1))
	}
	if reading.brand == "" || product == "" {
		return smartLabelCapture{}, false
	}
	unit := ""
	if reading.unit == "g" || reading.unit == "ml" {
		unit = reading.unit
	}
	return smartLabelCapture{
		brand: reading.brand, product: product, flavor: reading.flavor, unit: unit,
		net: reading.net, evidence: reading.evidence, label: label,
	}, true
}

func smartLabelConsistent(label map[string]any) bool {
	if len(label) == 0 {
		return false
	}
	kcal := numberFromAny(label["calories"])
	protein, fat, carbs := numberFromAny(label["protein"]), numberFromAny(label["fat"]), numberFromAny(label["carbs"])
	if kcal <= 0 || kcal > smartLabelMaxKcalPer100g || protein < 0 || fat < 0 || carbs < 0 || protein+fat+carbs > 100 {
		return false
	}
	return math.Abs(kcal-(4*protein+4*carbs+9*fat)) <= math.Max(25, 0.25*kcal)
}

// captureSmartLabels stores new products after the response is built. It
// never blocks or fails the analysis.
func (s *AnalyzeService) captureSmartLabels(ctx context.Context, captures []smartLabelCapture) {
	capturer, ok := s.nutrition.(packagedFoodCapturer)
	if !ok || len(captures) == 0 {
		return
	}
	taskID := ""
	if req, _ := ctx.Value(visionRequestKey{}).(*visionRequest); req != nil {
		taskID = req.taskID
	}
	background := context.WithoutCancel(ctx)
	smartRunLabelCapture(func() {
		ctx, cancel := context.WithTimeout(background, smartLabelCaptureTimeout)
		defer cancel()
		for _, capture := range captures {
			if s.smartLibraryKnows(ctx, capture) {
				continue
			}
			created, err := capturer.CapturePackagedFoodIfAbsent(ctx, smartLabelCaptureInput(capture, taskID))
			if err != nil {
				logger.Warn(ctx, "照片营养表收录失败", logger.Err(err), slog.String("brand", capture.brand), slog.String("product", capture.product))
				continue
			}
			if created {
				logger.Info(ctx, "照片营养表已收录到包装食品库", slog.String("brand", capture.brand), slog.String("product", capture.product), slog.String("task_id", taskID))
			}
		}
	})
}

// smartLibraryKnows asks the photo matcher itself: a product it would already
// match is not added again under another spelling.
func (s *AnalyzeService) smartLibraryKnows(ctx context.Context, capture smartLabelCapture) bool {
	candidates, err := s.searchSmartPackagedCandidates(ctx, capture.brand, capture.product)
	if err != nil {
		return true
	}
	food, _ := smartPickPackagedCandidate(capture.brand, capture.product, capture.flavor, candidates)
	return food != nil
}

func smartLabelCaptureInput(capture smartLabelCapture, taskID string) foodrecordrepo.PackagedFoodInput {
	basis := "100g"
	if capture.unit == "ml" {
		basis = "100ml"
	}
	input := foodrecordrepo.PackagedFoodInput{
		Brand: capture.brand, ProductName: capture.product, FlavorText: capture.flavor,
		PackageCategory:    smartPackagedHead(capture.brand + capture.product),
		NutritionBasisUnit: basis, EnergyUnitRaw: "kcal/" + basis, ConversionStatus: "source_per_100g",
		IngestMethod: smartLabelCaptureIngest, Source: smartLabelCaptureSource, ReviewStatus: "active",
		ExtractConfidence: 0.8,
		FieldConfidence:   map[string]any{"source": "nutrition panel read from a meal photo", "reviewed": false},
		RawLabelPayload: map[string]any{
			"source": smartLabelCaptureSource, "task_id": taskID, "evidence": capture.evidence,
			"read_model": smartPackageReadModel, "captured_at": time.Now().Format(time.RFC3339),
		},
		KcalPer100g:    numberFromAny(capture.label["calories"]),
		ProteinPer100g: numberFromAny(capture.label["protein"]),
		FatPer100g:     numberFromAny(capture.label["fat"]),
		CarbsPer100g:   numberFromAny(capture.label["carbs"]),
	}
	if capture.unit != "" && capture.net > 0 {
		input.NetContentValue, input.NetContentUnit, input.UnitCount = capture.net, capture.unit, 1
		input.NetWeightG = capture.net // the label values treat 1 ml as 1 g
		input.SpecText = fmt.Sprintf("%g%s", capture.net, capture.unit)
	}
	return input
}
