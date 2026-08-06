package service

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	petdomain "food_link/backend/internal/pet/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePixelAvatarGenerator struct {
	output []byte
	err    error
}

func (f *fakePixelAvatarGenerator) GeneratePixelAvatar(_ context.Context, source []byte) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if len(f.output) > 0 {
		return append([]byte(nil), f.output...), nil
	}
	return append([]byte(nil), source...), nil
}

type fakePetAvatarStorage struct {
	bucket      string
	key         string
	keys        []string
	data        []byte
	contentType string
}

func TestCustomizePixelAvatarRejectsLongPetName(t *testing.T) {
	svc := NewService(newFakePetRepo())
	svc.ConfigureStorage(&fakePetAvatarStorage{})
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{})

	_, err := svc.CustomizePixelAvatar(t.Context(), "user-1", strings.Repeat("名", 13), []byte("image"))
	require.ErrorIs(t, err, ErrInvalidPetName)
}

func (f *fakePetAvatarStorage) UploadBytes(bucketAlias, key string, data []byte, contentType string) (string, error) {
	f.bucket = bucketAlias
	f.key = key
	f.keys = append(f.keys, key)
	f.data = append([]byte(nil), data...)
	f.contentType = contentType
	return f.BuildAccessURL(bucketAlias, key), nil
}

func (f *fakePetAvatarStorage) BuildAccessURL(bucketAlias, key string) string {
	return "https://cdn.example.test/" + bucketAlias + "/" + key
}

func TestCreatePixelAvatarPNGProducesSquarePixelImage(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 80, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 80; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 3), G: uint8(y * 2), B: 120, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	result, err := createPixelAvatarPNG(encoded.Bytes())
	require.NoError(t, err)
	decoded, err := png.Decode(bytes.NewReader(result))
	require.NoError(t, err)
	assert.Equal(t, pixelAvatarSize, decoded.Bounds().Dx())
	assert.Equal(t, pixelAvatarSize, decoded.Bounds().Dy())

	first := decoded.At(0, 0)
	next := decoded.At(1, 1)
	assert.Equal(t, first, next, "nearest-neighbor upscale should preserve visible pixel blocks")
}

func TestCreatePixelAvatarPNGRemovesConnectedWhiteBorderAndHardensAlpha(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 96, 96))
	for y := 0; y < 96; y++ {
		for x := 0; x < 96; x++ {
			fill := color.NRGBA{R: 250, G: 250, B: 250, A: 255}
			if x >= 20 && x < 76 && y >= 14 && y < 86 {
				fill = color.NRGBA{R: 190, G: 80, B: 70, A: 255}
			}
			source.SetNRGBA(x, y, fill)
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	result, err := createPixelAvatarPNG(encoded.Bytes())
	require.NoError(t, err)
	decoded, err := png.Decode(bytes.NewReader(result))
	require.NoError(t, err)

	_, _, _, cornerAlpha := decoded.At(0, 0).RGBA()
	_, _, _, centerAlpha := decoded.At(pixelAvatarSize/2, pixelAvatarSize/2).RGBA()
	assert.Equal(t, uint32(0), cornerAlpha)
	assert.Equal(t, uint32(0xffff), centerAlpha)
}

func TestCreatePixelAvatarPNGRemovesConnectedNeutralBackground(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 96, 96))
	for y := 0; y < 96; y++ {
		for x := 0; x < 96; x++ {
			shade := uint8(120 + (x+y)/4)
			fill := color.NRGBA{R: shade, G: shade, B: shade, A: 255}
			if x >= 24 && x < 72 && y >= 16 && y < 88 {
				fill = color.NRGBA{R: 190, G: 90, B: 65, A: 255}
			}
			source.SetNRGBA(x, y, fill)
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	result, err := createPixelAvatarPNG(encoded.Bytes())
	require.NoError(t, err)
	decoded, err := png.Decode(bytes.NewReader(result))
	require.NoError(t, err)

	_, _, _, cornerAlpha := decoded.At(0, 0).RGBA()
	_, _, _, centerAlpha := decoded.At(pixelAvatarSize/2, pixelAvatarSize/2).RGBA()
	assert.Equal(t, uint32(0), cornerAlpha)
	assert.Equal(t, uint32(0xffff), centerAlpha)
}

func TestCreatePixelAvatarAnimationPNGsSplitsFourFrameSpriteSheet(t *testing.T) {
	source := makeTestPixelAvatarSpriteSheet(t)

	frames, err := createPixelAvatarAnimationPNGs(source)
	require.NoError(t, err)
	assert.NotEmpty(t, frames.Idle)
	assert.NotEmpty(t, frames.Blink)
	assert.NotEmpty(t, frames.Squash)
	assert.NotEmpty(t, frames.Jump)
	assert.Equal(t, 4, countPixelAvatarFrames(frames))

	for _, frame := range [][]byte{frames.Idle, frames.Blink, frames.Squash, frames.Jump} {
		decoded, decodeErr := png.Decode(bytes.NewReader(frame))
		require.NoError(t, decodeErr)
		assert.Equal(t, pixelAvatarSize, decoded.Bounds().Dx())
		assert.Equal(t, pixelAvatarSize, decoded.Bounds().Dy())
	}
}

func TestCustomizePixelAvatarStoresOnlyGeneratedAvatarMetadata(t *testing.T) {
	repository := newFakePetRepo()
	repository.pet = &petdomain.UserPet{
		ID:      "pet-1",
		UserID:  "user-1",
		PetSeed: "seed",
		Name:    "小满",
		Color:   "mint",
		Shape:   "round",
		Pattern: "pattern-0",
		Meta:    map[string]any{"existing": "kept"},
		Level:   1,
	}
	storage := &fakePetAvatarStorage{}
	svc := NewService(repository)
	svc.ConfigureStorage(storage)
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{})

	source := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 80, G: 160, B: 120, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	result, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "水滴汤圆", encoded.Bytes())
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "user-avatars", storage.bucket)
	assert.Equal(t, "image/png", storage.contentType)
	assert.True(t, strings.HasPrefix(storage.key, "pixel-avatars/user-1/"))
	assert.Equal(t, "pixel_self", result.Pet.AvatarType)
	assert.Equal(t, "水滴汤圆", result.Pet.Name)
	assert.Contains(t, result.Pet.PixelAvatarURL, storage.key)
	assert.Equal(t, "kept", repository.pet.Meta["existing"])
	assert.Equal(t, storage.key, repository.pet.Meta["pixel_avatar_key"])
}

func TestCustomizePixelAvatarStoresAnimationFrameMetadata(t *testing.T) {
	repository := newFakePetRepo()
	repository.pet = &petdomain.UserPet{
		ID:      "pet-1",
		UserID:  "user-1",
		PetSeed: "seed",
		Name:    "小满",
		Color:   "mint",
		Shape:   "round",
		Pattern: "pattern-0",
		Meta:    map[string]any{},
		Level:   1,
	}
	storage := &fakePetAvatarStorage{}
	svc := NewService(repository)
	svc.ConfigureStorage(storage)
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{output: makeTestPixelAvatarSpriteSheet(t)})

	result, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "小满", makeTestPixelAvatarSpriteSheet(t))
	require.NoError(t, err)
	require.Len(t, storage.keys, 4)
	assert.Contains(t, storage.keys[0], "/idle.png")
	assert.Contains(t, storage.keys[1], "/blink.png")
	assert.Contains(t, storage.keys[2], "/squash.png")
	assert.Contains(t, storage.keys[3], "/jump.png")
	assert.Equal(t, storage.keys[0], repository.pet.Meta["pixel_avatar_key"])
	assert.Equal(t, storage.keys[1], repository.pet.Meta["pixel_avatar_blink_key"])
	assert.Equal(t, storage.keys[2], repository.pet.Meta["pixel_avatar_squash_key"])
	assert.Equal(t, storage.keys[3], repository.pet.Meta["pixel_avatar_jump_key"])
	assert.Contains(t, result.Pet.PixelAvatarURL, storage.keys[0])
	assert.Contains(t, result.Pet.PixelAvatarBlinkURL, storage.keys[1])
	assert.Contains(t, result.Pet.PixelAvatarSquashURL, storage.keys[2])
	assert.Contains(t, result.Pet.PixelAvatarJumpURL, storage.keys[3])
}

func TestCustomizePixelAvatarKeepsCurrentAvatarUntilExplicitReplacement(t *testing.T) {
	repository := newFakePetRepo()
	repository.pet = &petdomain.UserPet{
		ID:      "pet-1",
		UserID:  "user-1",
		PetSeed: "seed",
		Name:    "小满",
		Color:   "mint",
		Shape:   "round",
		Pattern: "pattern-0",
		Meta:    map[string]any{},
		Level:   1,
	}
	storage := &fakePetAvatarStorage{}
	svc := NewService(repository)
	svc.ConfigureStorage(storage)
	svc.ConfigurePixelAvatarGenerator(&fakePixelAvatarGenerator{})

	makeSource := func(fill color.NRGBA) []byte {
		source := image.NewNRGBA(image.Rect(0, 0, 32, 32))
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				source.SetNRGBA(x, y, fill)
			}
		}
		var encoded bytes.Buffer
		require.NoError(t, png.Encode(&encoded, source))
		return encoded.Bytes()
	}

	first, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "小满", makeSource(color.NRGBA{R: 80, G: 160, B: 120, A: 255}))
	require.NoError(t, err)
	firstKey, _ := repository.pet.Meta["pixel_avatar_key"].(string)
	assert.Contains(t, first.Pet.PixelAvatarURL, firstKey)

	second, err := svc.CustomizePixelAvatar(t.Context(), "user-1", "小满", makeSource(color.NRGBA{R: 190, G: 110, B: 90, A: 255}))
	require.NoError(t, err)
	secondKey, _ := repository.pet.Meta["pixel_avatar_key"].(string)

	require.Len(t, storage.keys, 2)
	assert.NotEqual(t, firstKey, secondKey)
	assert.Equal(t, storage.keys[1], secondKey)
	assert.Contains(t, second.Pet.PixelAvatarURL, secondKey)
}

func TestMealStateFromDetails(t *testing.T) {
	assert.Equal(t, "hungry", mealStateFromDetails(nil))
	assert.Equal(t, "fed", mealStateFromDetails(map[string]any{"recorded_meal": true}))
	assert.Equal(t, "satisfied", mealStateFromDetails(map[string]any{"recorded_meal": true, "three_meals": true}))
}

func makeTestPixelAvatarSpriteSheet(t *testing.T) []byte {
	t.Helper()
	source := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	fills := []color.NRGBA{
		{R: 220, G: 155, B: 105, A: 255},
		{R: 218, G: 150, B: 100, A: 255},
		{R: 225, G: 160, B: 110, A: 255},
		{R: 215, G: 148, B: 98, A: 255},
	}
	for index, fill := range fills {
		offsetX := (index % 2) * 64
		offsetY := (index / 2) * 64
		for y := offsetY + 10; y < offsetY+54; y++ {
			for x := offsetX + 12; x < offsetX+52; x++ {
				source.SetNRGBA(x, y, fill)
			}
		}
		for y := offsetY + 19; y < offsetY+22; y++ {
			for _, eyeX := range []int{offsetX + 29, offsetX + 35} {
				source.SetNRGBA(eyeX, y, color.NRGBA{R: 35, G: 28, B: 24, A: 255})
				source.SetNRGBA(eyeX+1, y, color.NRGBA{R: 35, G: 28, B: 24, A: 255})
			}
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))
	return encoded.Bytes()
}
