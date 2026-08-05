package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	pixelAvatarGridSize  = 96
	pixelAvatarSize      = 384
	maxPixelAvatarPixels = 25_000_000
)

var (
	ErrPixelAvatarStorageUnavailable = errors.New("pixel avatar storage unavailable")
	ErrInvalidPixelAvatarImage       = errors.New("invalid pixel avatar image")
	ErrInvalidPetName                = errors.New("invalid pet name")
)

type PixelAvatarResult struct {
	Pet PetProfile `json:"pet"`
}

type pixelAvatarAnimationPNGs struct {
	Idle   []byte
	Blink  []byte
	Squash []byte
	Jump   []byte
}

func (s *Service) CustomizePixelAvatar(ctx context.Context, userID, name string, source []byte) (*PixelAvatarResult, error) {
	if s.storage == nil {
		return nil, ErrPixelAvatarStorageUnavailable
	}
	if s.pixelAvatarGenerator == nil {
		return nil, ErrPixelAvatarGenerationUnavailable
	}
	userID = strings.TrimSpace(userID)
	name = strings.TrimSpace(name)
	if userID == "" || len(source) == 0 {
		return nil, ErrInvalidPixelAvatarImage
	}
	if utf8.RuneCountInString(name) > 12 {
		return nil, ErrInvalidPetName
	}

	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	pet, err := s.ensurePet(ctx, userID, profile)
	if err != nil {
		return nil, err
	}
	pet, err = s.ensureProfileMatch(ctx, userID, pet, profile)
	if err != nil {
		return nil, err
	}
	if pet == nil {
		return nil, errors.New("pet profile not found")
	}

	totalStartedAt := time.Now()
	modelStartedAt := time.Now()
	logger.Info(ctx, "开始调用像素分身图像模型",
		slog.String("user_id", userID),
		slog.Int("source_bytes", len(source)),
	)
	modelOutput, err := s.pixelAvatarGenerator.GeneratePixelAvatar(ctx, source)
	if err != nil {
		logger.Error(ctx, "像素分身图像模型调用失败", err,
			slog.String("user_id", userID),
			slog.Int64("model.duration_ms", time.Since(modelStartedAt).Milliseconds()),
		)
		return nil, err
	}
	logger.Info(ctx, "像素分身图像模型调用完成",
		slog.String("user_id", userID),
		slog.Int("model.output_bytes", len(modelOutput)),
		slog.Int64("model.duration_ms", time.Since(modelStartedAt).Milliseconds()),
	)

	postprocessStartedAt := time.Now()
	frames, err := createPixelAvatarAnimationPNGs(modelOutput)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "像素分身清晰化处理完成",
		slog.String("user_id", userID),
		slog.Int("idle_bytes", len(frames.Idle)),
		slog.Bool("animation_frames_ready", len(frames.Blink) > 0 && len(frames.Squash) > 0 && len(frames.Jump) > 0),
		slog.Int64("postprocess.duration_ms", time.Since(postprocessStartedAt).Milliseconds()),
	)

	avatarPrefix := fmt.Sprintf("pixel-avatars/%s/%s", userID, uuid.NewString())
	uploadStartedAt := time.Now()
	uploadFrame := func(name string, data []byte) (string, error) {
		if len(data) == 0 {
			return "", nil
		}
		key := avatarPrefix + "/" + name + ".png"
		if _, err := s.storage.UploadBytes("user-avatars", key, data, "image/png"); err != nil {
			return "", err
		}
		return key, nil
	}
	key, err := uploadFrame("idle", frames.Idle)
	if err != nil {
		return nil, err
	}
	blinkKey, err := uploadFrame("blink", frames.Blink)
	if err != nil {
		return nil, err
	}
	squashKey, err := uploadFrame("squash", frames.Squash)
	if err != nil {
		return nil, err
	}
	jumpKey, err := uploadFrame("jump", frames.Jump)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "像素分身上传完成",
		slog.String("user_id", userID),
		slog.String("object_key", key),
		slog.Int("frame_count", countPixelAvatarFrames(frames)),
		slog.Int64("storage.duration_ms", time.Since(uploadStartedAt).Milliseconds()),
	)

	meta := clonePetMeta(pet.Meta)
	meta["avatar_type"] = "pixel_self"
	delete(meta, "builtin_avatar_id")
	meta["pixel_avatar_key"] = key
	setOptionalPixelAvatarMeta(meta, "pixel_avatar_blink_key", blinkKey)
	setOptionalPixelAvatarMeta(meta, "pixel_avatar_squash_key", squashKey)
	setOptionalPixelAvatarMeta(meta, "pixel_avatar_jump_key", jumpKey)
	meta["pixel_avatar_updated_at"] = time.Now().UTC().Format(time.RFC3339)
	updates := map[string]any{"meta": meta}
	if name != "" {
		updates["name"] = name
	}
	if err := s.repo.UpdatePet(ctx, pet.ID, updates); err != nil {
		return nil, err
	}
	logger.Info(ctx, "像素分身元数据更新完成",
		slog.String("user_id", userID),
		slog.String("pet_id", pet.ID),
		slog.Int64("total.duration_ms", time.Since(totalStartedAt).Milliseconds()),
	)

	updated, err := s.repo.GetPetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &PixelAvatarResult{Pet: s.profileFromPet(updated)}, nil
}

func createPixelAvatarAnimationPNGs(source []byte) (pixelAvatarAnimationPNGs, error) {
	decoded, err := decodePixelAvatarImage(source)
	if err != nil {
		return pixelAvatarAnimationPNGs{}, err
	}
	if !looksLikePixelAvatarSpriteSheet(decoded) {
		idle, err := createPixelAvatarPNG(source)
		if err != nil {
			return pixelAvatarAnimationPNGs{}, err
		}
		blink, _ := createPixelAvatarBlinkPNG(idle)
		return pixelAvatarAnimationPNGs{Idle: idle, Blink: blink}, nil
	}

	bounds := decoded.Bounds()
	middleX := bounds.Min.X + bounds.Dx()/2
	middleY := bounds.Min.Y + bounds.Dy()/2
	rects := []image.Rectangle{
		image.Rect(bounds.Min.X, bounds.Min.Y, middleX, middleY),
		image.Rect(middleX, bounds.Min.Y, bounds.Max.X, middleY),
		image.Rect(bounds.Min.X, middleY, middleX, bounds.Max.Y),
		image.Rect(middleX, middleY, bounds.Max.X, bounds.Max.Y),
	}
	encoded := make([][]byte, 0, len(rects))
	for _, rect := range rects {
		frame, frameErr := createPixelAvatarFramePNG(decoded, rect)
		if frameErr != nil {
			return pixelAvatarAnimationPNGs{}, frameErr
		}
		encoded = append(encoded, frame)
	}
	blink, _ := createPixelAvatarBlinkPNG(encoded[0])
	return pixelAvatarAnimationPNGs{
		Idle:   encoded[0],
		Blink:  blink,
		Squash: encoded[2],
		Jump:   encoded[3],
	}, nil
}

func createPixelAvatarBlinkPNG(source []byte) ([]byte, bool) {
	decoded, err := decodePixelAvatarImage(source)
	if err != nil {
		return nil, false
	}
	grid := image.NewNRGBA(image.Rect(0, 0, pixelAvatarGridSize, pixelAvatarGridSize))
	xdraw.NearestNeighbor.Scale(grid, grid.Bounds(), decoded, decoded.Bounds(), xdraw.Src, nil)

	foreground := opaqueBounds(grid)
	if foreground.Empty() || foreground.Dx() < 18 || foreground.Dy() < 24 {
		return nil, false
	}
	search := image.Rect(
		foreground.Min.X+foreground.Dx()*22/100,
		foreground.Min.Y+foreground.Dy()*10/100,
		foreground.Max.X-foreground.Dx()*22/100,
		foreground.Min.Y+foreground.Dy()*52/100,
	).Intersect(grid.Bounds())
	face := skinBounds(grid, search)
	if face.Empty() || face.Dx() < 12 || face.Dy() < 10 {
		return nil, false
	}

	expectedEyeY := face.Min.Y + face.Dy()*31/100
	leftExpectedX := face.Min.X + face.Dx()*40/100
	rightExpectedX := face.Min.X + face.Dx()*60/100
	eyeRadiusX := max(3, face.Dx()/9)
	eyeRadiusY := max(2, face.Dy()/11)
	leftSearch := image.Rect(
		leftExpectedX-eyeRadiusX,
		expectedEyeY-eyeRadiusY,
		leftExpectedX+eyeRadiusX+1,
		expectedEyeY+eyeRadiusY+1,
	).Intersect(grid.Bounds())
	rightSearch := image.Rect(
		rightExpectedX-eyeRadiusX,
		expectedEyeY-eyeRadiusY,
		rightExpectedX+eyeRadiusX+1,
		expectedEyeY+eyeRadiusY+1,
	).Intersect(grid.Bounds())
	leftEye, leftColor, leftOK := locatePixelAvatarEye(grid, leftSearch)
	rightEye, rightColor, rightOK := locatePixelAvatarEye(grid, rightSearch)
	if !leftOK || !rightOK || rightEye.X-leftEye.X < max(4, face.Dx()/5) {
		return nil, false
	}
	eyeY := (leftEye.Y + rightEye.Y) / 2
	skin := averageSkinColor(grid, face)
	clearPixelAvatarEyeBridge(grid, leftEye.X, rightEye.X, eyeY, skin, face)
	paintClosedPixelEye(grid, image.Pt(leftEye.X, eyeY), skin, leftColor, face)
	paintClosedPixelEye(grid, image.Pt(rightEye.X, eyeY), skin, rightColor, face)

	result := image.NewNRGBA(image.Rect(0, 0, pixelAvatarSize, pixelAvatarSize))
	xdraw.NearestNeighbor.Scale(result, result.Bounds(), grid, grid.Bounds(), xdraw.Src, nil)
	var output bytes.Buffer
	if err := png.Encode(&output, result); err != nil {
		return nil, false
	}
	return output.Bytes(), true
}

func createPixelAvatarPNG(source []byte) ([]byte, error) {
	decoded, err := decodePixelAvatarImage(source)
	if err != nil {
		return nil, err
	}

	cleaned := image.NewNRGBA(decoded.Bounds())
	draw.Draw(cleaned, cleaned.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	clearConnectedLightBorder(cleaned)
	clearConnectedNeutralBorder(cleaned)

	crop := portraitSquare(cleaned.Bounds())
	return encodePixelAvatarFrame(cleaned, crop)
}

func decodePixelAvatarImage(source []byte) (*image.NRGBA, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil ||
		config.Width < 8 ||
		config.Height < 8 ||
		config.Width > maxPixelAvatarPixels/config.Height {
		return nil, ErrInvalidPixelAvatarImage
	}
	decoded, _, err := image.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPixelAvatarImage, err)
	}
	bounds := decoded.Bounds()
	if bounds.Dx() < 8 || bounds.Dy() < 8 {
		return nil, ErrInvalidPixelAvatarImage
	}
	result := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(result, result.Bounds(), decoded, bounds.Min, draw.Src)
	return result, nil
}

func createPixelAvatarFramePNG(source *image.NRGBA, crop image.Rectangle) ([]byte, error) {
	if source == nil || crop.Empty() || !crop.In(source.Bounds()) {
		return nil, ErrInvalidPixelAvatarImage
	}
	cell := image.NewNRGBA(image.Rect(0, 0, crop.Dx(), crop.Dy()))
	draw.Draw(cell, cell.Bounds(), source, crop.Min, draw.Src)
	clearConnectedLightBorder(cell)
	clearConnectedNeutralBorder(cell)
	return encodePixelAvatarFrame(cell, portraitSquare(cell.Bounds()))
}

func encodePixelAvatarFrame(source *image.NRGBA, crop image.Rectangle) ([]byte, error) {
	grid := image.NewNRGBA(image.Rect(0, 0, pixelAvatarGridSize, pixelAvatarGridSize))
	xdraw.NearestNeighbor.Scale(grid, grid.Bounds(), source, crop, xdraw.Src, nil)
	posterize(grid)

	result := image.NewNRGBA(image.Rect(0, 0, pixelAvatarSize, pixelAvatarSize))
	xdraw.NearestNeighbor.Scale(result, result.Bounds(), grid, grid.Bounds(), xdraw.Src, nil)

	var output bytes.Buffer
	if err := png.Encode(&output, result); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func looksLikePixelAvatarSpriteSheet(img *image.NRGBA) bool {
	if img == nil {
		return false
	}
	bounds := img.Bounds()
	if bounds.Dx() < 64 || bounds.Dy() < 64 {
		return false
	}
	cleaned := image.NewNRGBA(bounds)
	draw.Draw(cleaned, bounds, img, bounds.Min, draw.Src)
	clearConnectedLightBorder(cleaned)
	clearConnectedNeutralBorder(cleaned)

	middleX := bounds.Min.X + bounds.Dx()/2
	middleY := bounds.Min.Y + bounds.Dy()/2
	bandX := max(2, bounds.Dx()/128)
	bandY := max(2, bounds.Dy()/128)
	verticalGutter := image.Rect(middleX-bandX, bounds.Min.Y, middleX+bandX, bounds.Max.Y)
	horizontalGutter := image.Rect(bounds.Min.X, middleY-bandY, bounds.Max.X, middleY+bandY)
	verticalSeparated := transparentRatio(cleaned, verticalGutter) >= 0.72 ||
		maxTransparentColumnRatio(cleaned, verticalGutter) >= 0.72
	horizontalSeparated := transparentRatio(cleaned, horizontalGutter) >= 0.72 ||
		maxTransparentRowRatio(cleaned, horizontalGutter) >= 0.72
	if !verticalSeparated || !horizontalSeparated {
		return false
	}

	quadrants := []image.Rectangle{
		image.Rect(bounds.Min.X, bounds.Min.Y, middleX, middleY),
		image.Rect(middleX, bounds.Min.Y, bounds.Max.X, middleY),
		image.Rect(bounds.Min.X, middleY, middleX, bounds.Max.Y),
		image.Rect(middleX, middleY, bounds.Max.X, bounds.Max.Y),
	}
	for _, quadrant := range quadrants {
		if opaqueRatio(cleaned, quadrant) < 0.01 {
			return false
		}
	}
	return true
}

func transparentRatio(img *image.NRGBA, bounds image.Rectangle) float64 {
	if img == nil {
		return 0
	}
	bounds = bounds.Intersect(img.Bounds())
	if bounds.Empty() {
		return 0
	}
	transparent := 0
	total := bounds.Dx() * bounds.Dy()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if img.NRGBAAt(x, y).A < 32 {
				transparent++
			}
		}
	}
	return float64(transparent) / float64(total)
}

func maxTransparentColumnRatio(img *image.NRGBA, bounds image.Rectangle) float64 {
	if img == nil {
		return 0
	}
	bounds = bounds.Intersect(img.Bounds())
	if bounds.Empty() {
		return 0
	}
	best := 0.0
	for x := bounds.Min.X; x < bounds.Max.X; x++ {
		transparent := 0
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			if img.NRGBAAt(x, y).A < 32 {
				transparent++
			}
		}
		ratio := float64(transparent) / float64(bounds.Dy())
		if ratio > best {
			best = ratio
		}
	}
	return best
}

func maxTransparentRowRatio(img *image.NRGBA, bounds image.Rectangle) float64 {
	if img == nil {
		return 0
	}
	bounds = bounds.Intersect(img.Bounds())
	if bounds.Empty() {
		return 0
	}
	best := 0.0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		transparent := 0
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if img.NRGBAAt(x, y).A < 32 {
				transparent++
			}
		}
		ratio := float64(transparent) / float64(bounds.Dx())
		if ratio > best {
			best = ratio
		}
	}
	return best
}

func opaqueRatio(img *image.NRGBA, bounds image.Rectangle) float64 {
	if img == nil {
		return 0
	}
	bounds = bounds.Intersect(img.Bounds())
	if bounds.Empty() {
		return 0
	}
	opaque := 0
	total := bounds.Dx() * bounds.Dy()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if img.NRGBAAt(x, y).A >= 128 {
				opaque++
			}
		}
	}
	return float64(opaque) / float64(total)
}

func countPixelAvatarFrames(frames pixelAvatarAnimationPNGs) int {
	count := 0
	for _, frame := range [][]byte{frames.Idle, frames.Blink, frames.Squash, frames.Jump} {
		if len(frame) > 0 {
			count++
		}
	}
	return count
}

func setOptionalPixelAvatarMeta(meta map[string]any, key, value string) {
	if value == "" {
		delete(meta, key)
		return
	}
	meta[key] = value
}

func opaqueBounds(img *image.NRGBA) image.Rectangle {
	if img == nil {
		return image.Rectangle{}
	}
	bounds := img.Bounds()
	minX, minY := bounds.Max.X, bounds.Max.Y
	maxX, maxY := bounds.Min.X, bounds.Min.Y
	found := false
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if img.NRGBAAt(x, y).A < 128 {
				continue
			}
			found = true
			minX = min(minX, x)
			minY = min(minY, y)
			maxX = max(maxX, x+1)
			maxY = max(maxY, y+1)
		}
	}
	if !found {
		return image.Rectangle{}
	}
	return image.Rect(minX, minY, maxX, maxY)
}

func skinBounds(img *image.NRGBA, search image.Rectangle) image.Rectangle {
	if img == nil {
		return image.Rectangle{}
	}
	search = search.Intersect(img.Bounds())
	minX, minY := search.Max.X, search.Max.Y
	maxX, maxY := search.Min.X, search.Min.Y
	found := false
	for y := search.Min.Y; y < search.Max.Y; y++ {
		for x := search.Min.X; x < search.Max.X; x++ {
			if !isPixelAvatarSkin(img.NRGBAAt(x, y)) {
				continue
			}
			found = true
			minX = min(minX, x)
			minY = min(minY, y)
			maxX = max(maxX, x+1)
			maxY = max(maxY, y+1)
		}
	}
	if !found {
		return image.Rectangle{}
	}
	return image.Rect(minX, minY, maxX, maxY)
}

func isPixelAvatarSkin(pixel color.NRGBA) bool {
	if pixel.A < 128 {
		return false
	}
	return pixel.R >= 105 &&
		pixel.R >= pixel.G &&
		int(pixel.R)-int(pixel.B) >= 18 &&
		int(pixel.G)-int(pixel.B) >= 2 &&
		int(pixel.R)-int(pixel.G) <= 105
}

func locatePixelAvatarEye(img *image.NRGBA, search image.Rectangle) (image.Point, color.NRGBA, bool) {
	if img == nil {
		return image.Point{}, color.NRGBA{}, false
	}
	search = search.Intersect(img.Bounds())
	bestY, bestScore := 0, 0
	for y := search.Min.Y; y < search.Max.Y; y++ {
		score := 0
		for x := search.Min.X; x < search.Max.X; x++ {
			pixel := img.NRGBAAt(x, y)
			if isDarkPixel(pixel) && hasNearbySkin(img, image.Pt(x, y), 2) {
				score++
			}
		}
		if score > 0 {
			bestY = y
			bestScore = score
		}
	}
	if bestScore == 0 {
		return image.Point{}, color.NRGBA{}, false
	}

	sumX, count := 0, 0
	sumR, sumG, sumB := 0, 0, 0
	for y := max(search.Min.Y, bestY-1); y <= min(search.Max.Y-1, bestY+1); y++ {
		for x := search.Min.X; x < search.Max.X; x++ {
			pixel := img.NRGBAAt(x, y)
			if !isDarkPixel(pixel) || !hasNearbySkin(img, image.Pt(x, y), 2) {
				continue
			}
			sumX += x
			sumR += int(pixel.R)
			sumG += int(pixel.G)
			sumB += int(pixel.B)
			count++
		}
	}
	if count == 0 {
		return image.Point{}, color.NRGBA{}, false
	}
	return image.Pt(sumX/count, bestY), color.NRGBA{
		R: uint8(sumR / count),
		G: uint8(sumG / count),
		B: uint8(sumB / count),
		A: 255,
	}, true
}

func isDarkPixel(pixel color.NRGBA) bool {
	if pixel.A < 128 {
		return false
	}
	luminance := (299*int(pixel.R) + 587*int(pixel.G) + 114*int(pixel.B)) / 1000
	return luminance <= 105
}

func hasNearbySkin(img *image.NRGBA, point image.Point, radius int) bool {
	bounds := img.Bounds()
	for y := max(bounds.Min.Y, point.Y-radius); y <= min(bounds.Max.Y-1, point.Y+radius); y++ {
		for x := max(bounds.Min.X, point.X-radius); x <= min(bounds.Max.X-1, point.X+radius); x++ {
			if isPixelAvatarSkin(img.NRGBAAt(x, y)) {
				return true
			}
		}
	}
	return false
}

func averageSkinColor(img *image.NRGBA, bounds image.Rectangle) color.NRGBA {
	bounds = bounds.Intersect(img.Bounds())
	sumR, sumG, sumB, count := 0, 0, 0, 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := img.NRGBAAt(x, y)
			if !isPixelAvatarSkin(pixel) {
				continue
			}
			sumR += int(pixel.R)
			sumG += int(pixel.G)
			sumB += int(pixel.B)
			count++
		}
	}
	if count == 0 {
		return color.NRGBA{R: 222, G: 170, B: 132, A: 255}
	}
	return color.NRGBA{
		R: uint8(sumR / count),
		G: uint8(sumG / count),
		B: uint8(sumB / count),
		A: 255,
	}
}

func paintClosedPixelEye(img *image.NRGBA, center image.Point, skin, line color.NRGBA, face image.Rectangle) {
	if img == nil {
		return
	}
	radiusX := 2
	radiusY := 4
	paint := image.Rect(center.X-radiusX, center.Y-radiusY, center.X+radiusX+1, center.Y+radiusY+2).
		Intersect(face).
		Intersect(img.Bounds())
	for y := paint.Min.Y; y < paint.Max.Y; y++ {
		for x := paint.Min.X; x < paint.Max.X; x++ {
			if img.NRGBAAt(x, y).A >= 128 {
				img.SetNRGBA(x, y, skin)
			}
		}
	}
	lineY := min(paint.Max.Y-1, center.Y)
	for x := max(paint.Min.X, center.X-radiusX+1); x <= min(paint.Max.X-1, center.X+radiusX-1); x++ {
		img.SetNRGBA(x, lineY, line)
	}
}

func clearPixelAvatarEyeBridge(img *image.NRGBA, leftX, rightX, centerY int, skin color.NRGBA, face image.Rectangle) {
	if img == nil || rightX-leftX < 5 {
		return
	}
	bridge := image.Rect(leftX+2, centerY-3, rightX-1, centerY+4).
		Intersect(face).
		Intersect(img.Bounds())
	for y := bridge.Min.Y; y < bridge.Max.Y; y++ {
		for x := bridge.Min.X; x < bridge.Max.X; x++ {
			if img.NRGBAAt(x, y).A >= 128 {
				img.SetNRGBA(x, y, skin)
			}
		}
	}
}

func portraitSquare(bounds image.Rectangle) image.Rectangle {
	width, height := bounds.Dx(), bounds.Dy()
	side := width
	if height < side {
		side = height
	}
	left := bounds.Min.X + (width-side)/2
	top := bounds.Min.Y + (height-side)/2
	if height > width {
		// Portrait photos usually place the face above the geometric center.
		top = bounds.Min.Y + (height-side)*2/5
	}
	return image.Rect(left, top, left+side, top+side)
}

func posterize(img *image.NRGBA) {
	for y := img.Bounds().Min.Y; y < img.Bounds().Max.Y; y++ {
		for x := img.Bounds().Min.X; x < img.Bounds().Max.X; x++ {
			pixel := img.NRGBAAt(x, y)
			alpha := uint8(255)
			if pixel.A < 128 {
				alpha = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{
				R: quantizeChannel(pixel.R),
				G: quantizeChannel(pixel.G),
				B: quantizeChannel(pixel.B),
				A: alpha,
			})
		}
	}
}

func clearConnectedLightBorder(img *image.NRGBA) {
	bounds := img.Bounds()
	if bounds.Empty() {
		return
	}
	width, height := bounds.Dx(), bounds.Dy()
	visited := make([]bool, width*height)
	queue := make([]image.Point, 0, 2*(width+height))

	indexOf := func(point image.Point) int {
		return (point.Y-bounds.Min.Y)*width + point.X - bounds.Min.X
	}
	enqueue := func(point image.Point) {
		if !point.In(bounds) {
			return
		}
		index := indexOf(point)
		if visited[index] || !isLightBorderPixel(img.NRGBAAt(point.X, point.Y)) {
			return
		}
		visited[index] = true
		queue = append(queue, point)
	}

	for x := bounds.Min.X; x < bounds.Max.X; x++ {
		enqueue(image.Pt(x, bounds.Min.Y))
		enqueue(image.Pt(x, bounds.Max.Y-1))
	}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		enqueue(image.Pt(bounds.Min.X, y))
		enqueue(image.Pt(bounds.Max.X-1, y))
	}

	for len(queue) > 0 {
		point := queue[0]
		queue = queue[1:]
		img.SetNRGBA(point.X, point.Y, color.NRGBA{})
		enqueue(image.Pt(point.X-1, point.Y))
		enqueue(image.Pt(point.X+1, point.Y))
		enqueue(image.Pt(point.X, point.Y-1))
		enqueue(image.Pt(point.X, point.Y+1))
	}
}

func clearConnectedNeutralBorder(img *image.NRGBA) {
	bounds := img.Bounds()
	if bounds.Empty() {
		return
	}
	width, height := bounds.Dx(), bounds.Dy()
	visited := make([]bool, width*height)
	queue := make([]image.Point, 0, 2*(width+height))

	indexOf := func(point image.Point) int {
		return (point.Y-bounds.Min.Y)*width + point.X - bounds.Min.X
	}
	isNeutralBackground := func(pixel color.NRGBA) bool {
		if pixel.A < 32 {
			return true
		}
		minChannel := min(pixel.R, min(pixel.G, pixel.B))
		maxChannel := max(pixel.R, max(pixel.G, pixel.B))
		return maxChannel-minChannel <= 42 && maxChannel >= 42
	}
	enqueue := func(point image.Point) {
		if !point.In(bounds) {
			return
		}
		index := indexOf(point)
		if visited[index] || !isNeutralBackground(img.NRGBAAt(point.X, point.Y)) {
			return
		}
		visited[index] = true
		queue = append(queue, point)
	}

	for x := bounds.Min.X; x < bounds.Max.X; x++ {
		enqueue(image.Pt(x, bounds.Min.Y))
		enqueue(image.Pt(x, bounds.Max.Y-1))
	}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		enqueue(image.Pt(bounds.Min.X, y))
		enqueue(image.Pt(bounds.Max.X-1, y))
	}

	for len(queue) > 0 {
		point := queue[0]
		queue = queue[1:]
		img.SetNRGBA(point.X, point.Y, color.NRGBA{})
		enqueue(image.Pt(point.X-1, point.Y))
		enqueue(image.Pt(point.X+1, point.Y))
		enqueue(image.Pt(point.X, point.Y-1))
		enqueue(image.Pt(point.X, point.Y+1))
	}
}

func isLightBorderPixel(pixel color.NRGBA) bool {
	if pixel.A < 32 {
		return true
	}
	minChannel := min(pixel.R, min(pixel.G, pixel.B))
	maxChannel := max(pixel.R, max(pixel.G, pixel.B))
	return minChannel >= 230 && maxChannel-minChannel <= 28
}

func quantizeChannel(value uint8) uint8 {
	const step = 16
	quantized := (int(value) + step/2) / step * step
	if quantized > 255 {
		quantized = 255
	}
	return uint8(quantized)
}

func clonePetMeta(meta map[string]any) map[string]any {
	cloned := make(map[string]any, len(meta)+6)
	for key, value := range meta {
		cloned[key] = value
	}
	return cloned
}
