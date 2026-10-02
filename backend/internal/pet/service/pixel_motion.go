package service

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"

	xdraw "golang.org/x/image/draw"
)

var ErrIncompletePixelMotion = errors.New("incomplete full-body pet motion atlas")

const pixelMotionVersion = 1
const pixelMotionCellSize = 256

type pixelMotionPNGs struct {
	pixelAvatarAnimationPNGs
	Atlas []byte
}

// Version 1 is a 4x4 full-body sheet. Keep the entire cell (including the feet),
// rather than the legacy portrait crop. Reject missing/clipped cells before
// uploading or changing the user's selected companion. Geometry checks cannot
// prove artistic identity or anatomy; those are also specified to the model.
func createPixelMotionPNGs(source []byte) (pixelMotionPNGs, error) {
	decoded, err := decodePixelAvatarImage(source)
	if err != nil {
		return pixelMotionPNGs{}, fmt.Errorf("%w: %v", ErrIncompletePixelMotion, err)
	}
	b := decoded.Bounds()
	if b.Dx() != b.Dy() || b.Dx() < 256 || b.Dx()%4 != 0 {
		return pixelMotionPNGs{}, ErrIncompletePixelMotion
	}
	cellSize := b.Dx() / 4
	atlas := image.NewNRGBA(image.Rect(0, 0, pixelMotionCellSize*4, pixelMotionCellSize*4))
	frames := make([][]byte, 16)
	posePixels := make([][]byte, 16)
	for index := 0; index < 16; index++ {
		x, y := b.Min.X+(index%4)*cellSize, b.Min.Y+(index/4)*cellSize
		cell := image.NewNRGBA(image.Rect(0, 0, cellSize, cellSize))
		draw.Draw(cell, cell.Bounds(), decoded, image.Pt(x, y), draw.Src)
		posePixels[index] = cell.Pix
		// Transparent gutters are part of the model contract. Do not erase light
		// clothing to salvage an opaque or wrongly packed model response.
		foreground := opaqueBounds(cell)
		margin := max(1, cellSize/50)
		if foreground.Empty() || foreground.Min.X < margin || foreground.Min.Y < margin || foreground.Max.X > cellSize-margin || foreground.Max.Y > cellSize-margin || foreground.Dy() < cellSize*40/100 {
			return pixelMotionPNGs{}, fmt.Errorf("%w: cell %d is missing or clipped", ErrIncompletePixelMotion, index)
		}
		if index == 0 && (foreground.Dy() < cellSize*60/100 || foreground.Dy()*100 < foreground.Dx()*115) {
			return pixelMotionPNGs{}, fmt.Errorf("%w: idle cell is portrait-shaped", ErrIncompletePixelMotion)
		}
		target := image.Rect((index%4)*pixelMotionCellSize, (index/4)*pixelMotionCellSize, (index%4+1)*pixelMotionCellSize, (index/4+1)*pixelMotionCellSize)
		xdraw.NearestNeighbor.Scale(atlas, target, cell, cell.Bounds(), draw.Src, nil)
		if index == 0 || index == 1 || index == 8 || index == 9 {
			compat := image.NewNRGBA(image.Rect(0, 0, pixelAvatarSize, pixelAvatarSize))
			xdraw.NearestNeighbor.Scale(compat, compat.Bounds(), cell, cell.Bounds(), draw.Src, nil)
			var buf bytes.Buffer
			if err := png.Encode(&buf, compat); err != nil {
				return pixelMotionPNGs{}, err
			}
			frames[index] = buf.Bytes()
		}
	}
	for _, pair := range [][2]int{{0, 1}, {2, 3}, {4, 5}, {8, 9}, {10, 11}, {12, 13}, {13, 14}, {14, 15}, {15, 12}, {12, 14}, {13, 15}} {
		if bytes.Equal(posePixels[pair[0]], posePixels[pair[1]]) {
			return pixelMotionPNGs{}, fmt.Errorf("%w: duplicated action cells %d/%d", ErrIncompletePixelMotion, pair[0], pair[1])
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, atlas); err != nil {
		return pixelMotionPNGs{}, err
	}
	return pixelMotionPNGs{pixelAvatarAnimationPNGs: pixelAvatarAnimationPNGs{Idle: frames[0], Blink: frames[1], Squash: frames[8], Jump: frames[9]}, Atlas: buf.Bytes()}, nil
}
