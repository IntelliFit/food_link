package service

import (
	"image"
	"math"
)

const (
	rankableImageMinShortEdge         = 600
	rankableImageMinBrightness        = 35.0
	rankableImageMaxBrightness        = 225.0
	rankableImageMinContrast          = 24.0
	rankableImageMinLaplacianVariance = 100.0
	rankableImageMaxClippedPixelRatio = 0.32
	rankableImageAnalysisMaxLongEdge  = 512
)

// RankableImageQualityAssessment contains deterministic pixel-level evidence
// used by the offline photo cleanup command. It deliberately favors precision:
// a photo that cannot prove it is clear enough is not suitable for a public
// leaderboard, although it can still remain useful for food analysis.
type RankableImageQualityAssessment struct {
	Eligible          bool
	Reason            string
	Width             int
	Height            int
	Brightness        float64
	Contrast          float64
	LaplacianVariance float64
	ClippedPixelRatio float64
}

// AssessRankableImageQuality rejects low-resolution, badly exposed, flat, or
// visibly blurred images. Pixels are sampled on a bounded grid so large phone
// photos do not make a full-library audit prohibitively expensive.
func AssessRankableImageQuality(img image.Image) RankableImageQualityAssessment {
	if img == nil {
		return RankableImageQualityAssessment{Reason: "decode_failed"}
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	assessment := RankableImageQualityAssessment{Width: width, Height: height}
	if width <= 0 || height <= 0 {
		assessment.Reason = "invalid_dimensions"
		return assessment
	}
	if minInt(width, height) < rankableImageMinShortEdge {
		assessment.Reason = "low_resolution"
		return assessment
	}

	step := maxInt(1, int(math.Ceil(float64(maxInt(width, height))/rankableImageAnalysisMaxLongEdge)))
	sampledWidth := (width + step - 1) / step
	sampledHeight := (height + step - 1) / step
	gray := make([]float64, sampledWidth*sampledHeight)
	var sum, sumSquares float64
	clipped := 0
	for sy, y := 0, bounds.Min.Y; sy < sampledHeight; sy, y = sy+1, y+step {
		if y >= bounds.Max.Y {
			y = bounds.Max.Y - 1
		}
		for sx, x := 0, bounds.Min.X; sx < sampledWidth; sx, x = sx+1, x+step {
			if x >= bounds.Max.X {
				x = bounds.Max.X - 1
			}
			r, g, b, _ := img.At(x, y).RGBA()
			value := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(b>>8)
			gray[sy*sampledWidth+sx] = value
			sum += value
			sumSquares += value * value
			if value <= 8 || value >= 247 {
				clipped++
			}
		}
	}

	pixelCount := float64(len(gray))
	assessment.Brightness = sum / pixelCount
	assessment.Contrast = math.Sqrt(math.Max(0, sumSquares/pixelCount-assessment.Brightness*assessment.Brightness))
	assessment.ClippedPixelRatio = float64(clipped) / pixelCount
	if assessment.Brightness < rankableImageMinBrightness || assessment.Brightness > rankableImageMaxBrightness ||
		assessment.ClippedPixelRatio > rankableImageMaxClippedPixelRatio {
		assessment.Reason = "bad_exposure"
		return assessment
	}
	if assessment.Contrast < rankableImageMinContrast {
		assessment.Reason = "low_contrast"
		return assessment
	}

	if sampledWidth < 3 || sampledHeight < 3 {
		assessment.Reason = "insufficient_detail"
		return assessment
	}
	laplacianCount := 0
	var laplacianSum, laplacianSquares float64
	for y := 1; y < sampledHeight-1; y++ {
		for x := 1; x < sampledWidth-1; x++ {
			center := gray[y*sampledWidth+x]
			laplacian := gray[(y-1)*sampledWidth+x] + gray[(y+1)*sampledWidth+x] +
				gray[y*sampledWidth+x-1] + gray[y*sampledWidth+x+1] - 4*center
			laplacianSum += laplacian
			laplacianSquares += laplacian * laplacian
			laplacianCount++
		}
	}
	laplacianMean := laplacianSum / float64(laplacianCount)
	assessment.LaplacianVariance = math.Max(0, laplacianSquares/float64(laplacianCount)-laplacianMean*laplacianMean)
	if assessment.LaplacianVariance < rankableImageMinLaplacianVariance {
		assessment.Reason = "blurred"
		return assessment
	}

	assessment.Eligible = true
	return assessment
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
