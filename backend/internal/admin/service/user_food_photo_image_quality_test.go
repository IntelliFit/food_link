package service

import (
	"image"
	"image/color"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAssessRankableImageQuality(t *testing.T) {
	t.Run("accepts a well exposed detailed image", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 900, 900))
		for y := 0; y < 900; y++ {
			for x := 0; x < 900; x++ {
				base := uint8(45)
				if (x/12+y/12)%2 == 0 {
					base = 220
				}
				img.SetRGBA(x, y, color.RGBA{R: base, G: base, B: base, A: 255})
			}
		}

		assessment := AssessRankableImageQuality(img)
		require.True(t, assessment.Eligible, assessment.Reason)
		assert.Empty(t, assessment.Reason)
	})

	t.Run("rejects a small image", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 320, 320))
		assessment := AssessRankableImageQuality(img)
		assert.False(t, assessment.Eligible)
		assert.Equal(t, "low_resolution", assessment.Reason)
	})

	t.Run("rejects an overexposed image", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 800, 800))
		for y := 0; y < 800; y++ {
			for x := 0; x < 800; x++ {
				img.SetRGBA(x, y, color.RGBA{R: 255, G: 253, B: 250, A: 255})
			}
		}
		assessment := AssessRankableImageQuality(img)
		assert.False(t, assessment.Eligible)
		assert.Equal(t, "bad_exposure", assessment.Reason)
	})

	t.Run("rejects a flat blurred-looking image", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 800, 800))
		for y := 0; y < 800; y++ {
			for x := 0; x < 800; x++ {
				value := uint8(80 + x*80/800)
				img.SetRGBA(x, y, color.RGBA{R: value, G: value, B: value, A: 255})
			}
		}
		assessment := AssessRankableImageQuality(img)
		assert.False(t, assessment.Eligible)
		assert.Contains(t, []string{"low_contrast", "blurred"}, assessment.Reason)
	})
}
