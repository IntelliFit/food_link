package service

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"

	petdomain "food_link/backend/internal/pet/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeTestPixelMotionSheet(t *testing.T) []byte {
	t.Helper()
	sheet := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	for index := 0; index < 16; index++ {
		x, y := (index%4)*64, (index/4)*64
		for py := 8; py < 54; py++ {
			for px := 22; px < 42; px++ {
				sheet.SetNRGBA(x+px, y+py, color.NRGBA{R: uint8(90 + index*6), G: 130, B: 70, A: 255})
			}
		}
		for py := 54; py < 59; py++ {
			for px := 20; px < 44; px++ {
				sheet.SetNRGBA(x+px, y+py, color.NRGBA{R: 200, G: 40, B: 50, A: 255})
			}
		}
	}
	return encodeMotionTestImage(t, sheet)
}

func encodeMotionTestImage(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func TestPixelMotionPreservesFeetAndTransparentMargins(t *testing.T) {
	frames, err := createPixelMotionPNGs(makeTestPixelMotionSheet(t))
	require.NoError(t, err)
	atlas, err := png.Decode(bytes.NewReader(frames.Atlas))
	require.NoError(t, err)
	assert.Equal(t, image.Rect(0, 0, 1024, 1024), atlas.Bounds())
	idle, err := png.Decode(bytes.NewReader(frames.Idle))
	require.NoError(t, err)
	assert.Equal(t, color.NRGBAModel.Convert(idle.At(24*6, 57*6)), color.NRGBA{R: 200, G: 40, B: 50, A: 255}, "feet must survive full-cell resizing")
	_, _, _, alpha := idle.At(0, 0).RGBA()
	assert.Zero(t, alpha)
	assert.NotEqual(t, frames.Idle, frames.Blink, "the model's own blink is preserved")
}

func TestPixelMotionRejectsMissingClippedPortraitAndDuplicatedCells(t *testing.T) {
	for _, kind := range []string{"missing", "clipped", "portrait", "duplicate", "ride-half-cycle"} {
		t.Run(kind, func(t *testing.T) {
			decoded, err := png.Decode(bytes.NewReader(makeTestPixelMotionSheet(t)))
			require.NoError(t, err)
			sheet := image.NewNRGBA(decoded.Bounds())
			for y := 0; y < 256; y++ {
				for x := 0; x < 256; x++ {
					sheet.Set(x, y, decoded.At(x, y))
				}
			}
			switch kind {
			case "missing":
				for y := 192; y < 256; y++ {
					for x := 192; x < 256; x++ {
						sheet.SetNRGBA(x, y, color.NRGBA{})
					}
				}
			case "clipped":
				sheet.SetNRGBA(0, 20, color.NRGBA{A: 255})
			case "portrait":
				for y := 0; y < 64; y++ {
					for x := 0; x < 64; x++ {
						sheet.SetNRGBA(x, y, color.NRGBA{})
					}
				}
				for y := 20; y < 44; y++ {
					for x := 20; x < 44; x++ {
						sheet.SetNRGBA(x, y, color.NRGBA{R: 200, A: 255})
					}
				}
			case "duplicate":
				for y := 0; y < 64; y++ {
					for x := 0; x < 64; x++ {
						sheet.Set(x+192, y, decoded.At(x+128, y))
					}
				}
			case "ride-half-cycle":
				// Four cycling slots must not be just an ABAB two-pose loop.
				for y := 192; y < 256; y++ {
					for x := 0; x < 128; x++ {
						sheet.Set(x+128, y, decoded.At(x, y))
					}
				}
			}
			_, err = createPixelMotionPNGs(encodeMotionTestImage(t, sheet))
			require.ErrorIs(t, err, ErrIncompletePixelMotion)
		})
	}
	_, err := createPixelMotionPNGs(makeTestPixelAvatarSpriteSheet(t))
	require.ErrorIs(t, err, ErrIncompletePixelMotion, "legacy 2x2 sheets must not become fake 16-frame animations")
}

func TestCustomizeIncompleteMotionKeepsOriginalIdentity(t *testing.T) {
	fake := newFakePetRepo()
	fake.pet = &petdomain.UserPet{ID: "pet-1", UserID: "user-1", Name: "鬼鬼", Meta: map[string]any{"avatar_type": "pixel_self", "pixel_avatar_key": "previous/idle.png", "custom_name": true}, Level: 3}
	svc := NewService(fake)
	storage := &fakePetAvatarStorage{}
	svc.ConfigureStorage(storage)
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{output: makeTestPixelAvatarSpriteSheet(t)})
	_, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "新名字", []byte("source"))
	require.ErrorIs(t, err, ErrIncompletePixelMotion)
	assert.Equal(t, "鬼鬼", fake.pet.Name)
	assert.Equal(t, "previous/idle.png", fake.pet.Meta["pixel_avatar_key"])
	assert.Empty(t, storage.keys)
}

func TestCustomizeAtlasUploadFailureKeepsOriginalIdentity(t *testing.T) {
	fake := newFakePetRepo()
	fake.pet = &petdomain.UserPet{ID: "pet-1", UserID: "user-1", Name: "鬼鬼", Meta: map[string]any{"avatar_type": "pixel_self", "pixel_avatar_key": "previous/idle.png"}, Level: 3}
	svc := NewService(fake)
	storage := &fakePetAvatarStorage{failAt: 5}
	svc.ConfigureStorage(storage)
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{output: makeTestPixelMotionSheet(t)})
	_, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "新名字", []byte("source"))
	require.Error(t, err)
	assert.False(t, errors.Is(err, ErrIncompletePixelMotion))
	assert.Equal(t, "鬼鬼", fake.pet.Name)
	assert.Equal(t, "previous/idle.png", fake.pet.Meta["pixel_avatar_key"])
	assert.NotContains(t, fake.pet.Meta, "pixel_motion_atlas_key")
}
