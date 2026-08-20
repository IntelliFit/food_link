package service

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeAnalyzeVideoExtractor struct {
	probe      videoProbeResult
	frameCount int
	err        error
}

func (f fakeAnalyzeVideoExtractor) Extract(_ context.Context, _, outputDir string, _ int) (videoProbeResult, []extractedVideoFrame, error) {
	if f.err != nil {
		return videoProbeResult{}, nil, f.err
	}
	frames := make([]extractedVideoFrame, 0, f.frameCount)
	for index := 0; index < f.frameCount; index++ {
		path := filepath.Join(outputDir, fmt.Sprintf("frame-%02d.jpg", index+1))
		if err := os.WriteFile(path, []byte{byte(index + 1)}, 0o600); err != nil {
			return videoProbeResult{}, nil, err
		}
		frames = append(frames, extractedVideoFrame{Path: path, TimestampMS: int64(index+1) * 500})
	}
	return f.probe, frames, nil
}

type fakeAnalyzeVideoStorage struct {
	uploadedKeys []string
	deleted      []string
	failAt       int
}

func (f *fakeAnalyzeVideoStorage) UploadBytes(_ string, key string, _ []byte, _ string) (string, error) {
	if f.failAt > 0 && len(f.uploadedKeys)+1 == f.failAt {
		return "", errors.New("upload failed")
	}
	f.uploadedKeys = append(f.uploadedKeys, key)
	return "https://cdn.example/" + key, nil
}

func (f *fakeAnalyzeVideoStorage) DeleteObject(_ string, value string) error {
	f.deleted = append(f.deleted, value)
	return nil
}

func TestUploadAnalyzeVideoExtractsAndUploadsFiveFrames(t *testing.T) {
	store := &fakeAnalyzeVideoStorage{}
	svc := &UploadService{
		videoStorage: store,
		videoExtractor: fakeAnalyzeVideoExtractor{
			probe:      videoProbeResult{DurationSeconds: 6.4, Width: 1080, Height: 1920},
			frameCount: 5,
		},
	}

	result, err := svc.UploadAnalyzeVideo(context.Background(), "user-1", "video.mp4", 1024)
	require.NoError(t, err)
	require.Len(t, result.Keyframes, 5)
	assert.Equal(t, "video_keyframes_v1", result.CaptureProtocol)
	assert.Equal(t, int64(6400), result.DurationMS)
	assert.Equal(t, "video_keyframe_1", result.Keyframes[0].Role)
	assert.Equal(t, int64(500), result.Keyframes[0].TimestampMS)
	assert.False(t, result.VideoID == "")
	assert.Len(t, store.uploadedKeys, 5)
	assert.Empty(t, store.deleted)
}

func TestUploadAnalyzeVideoRejectsInvalidDuration(t *testing.T) {
	svc := &UploadService{
		videoStorage: &fakeAnalyzeVideoStorage{},
		videoExtractor: fakeAnalyzeVideoExtractor{
			probe:      videoProbeResult{DurationSeconds: 1.5, Width: 1080, Height: 1920},
			frameCount: 5,
		},
	}

	_, err := svc.UploadAnalyzeVideo(context.Background(), "user-1", "video.mp4", 1024)
	require.Error(t, err)
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "至少录制 2 秒")
}

func TestUploadAnalyzeVideoCleansUploadedFramesOnFailure(t *testing.T) {
	store := &fakeAnalyzeVideoStorage{failAt: 3}
	svc := &UploadService{
		videoStorage: store,
		videoExtractor: fakeAnalyzeVideoExtractor{
			probe:      videoProbeResult{DurationSeconds: 6, Width: 1080, Height: 1920},
			frameCount: 5,
		},
	}

	_, err := svc.UploadAnalyzeVideo(context.Background(), "user-1", "video.mp4", 1024)
	require.Error(t, err)
	assert.Len(t, store.uploadedKeys, 2)
	assert.Equal(t, []string{
		"https://cdn.example/" + store.uploadedKeys[0],
		"https://cdn.example/" + store.uploadedKeys[1],
	}, store.deleted)
}

func TestParseAnalyzeVideoProbeAppliesPhoneRotation(t *testing.T) {
	probe, err := parseAnalyzeVideoProbe([]byte(`{
		"streams":[{"width":1920,"height":1080,"side_data_list":[{"rotation":-90}]}],
		"format":{"duration":"5.868938"}
	}`))
	require.NoError(t, err)
	assert.Equal(t, 1080, probe.Width)
	assert.Equal(t, 1920, probe.Height)
	assert.InDelta(t, 5.868938, probe.DurationSeconds, 0.000001)
}

func TestSelectSharpestAnalyzeVideoFramePrefersDetailedFrame(t *testing.T) {
	dir := t.TempDir()
	flatPath := filepath.Join(dir, "flat.jpg")
	detailedPath := filepath.Join(dir, "detailed.jpg")
	writeTestVideoFrame(t, flatPath, false)
	writeTestVideoFrame(t, detailedPath, true)

	selected := selectSharpestAnalyzeVideoFrame([]extractedVideoFrame{
		{Path: flatPath, TimestampMS: 500},
		{Path: detailedPath, TimestampMS: 700},
	})
	assert.Equal(t, detailedPath, selected.Path)
	assert.Equal(t, int64(700), selected.TimestampMS)
}

func writeTestVideoFrame(t *testing.T, path string, detailed bool) {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 96, 96))
	for y := 0; y < 96; y++ {
		for x := 0; x < 96; x++ {
			value := uint8(128)
			if detailed && ((x/8)+(y/8))%2 == 0 {
				value = 245
			} else if detailed {
				value = 10
			}
			img.SetGray(x, y, color.Gray{Y: value})
		}
	}
	file, err := os.Create(path)
	require.NoError(t, err)
	require.NoError(t, jpeg.Encode(file, img, &jpeg.Options{Quality: 95}))
	require.NoError(t, file.Close())
}

func TestFFmpegAnalyzeVideoExtractorWithRealSample(t *testing.T) {
	videoPath := os.Getenv("FOODLINK_TEST_VIDEO_PATH")
	if videoPath == "" {
		t.Skip("set FOODLINK_TEST_VIDEO_PATH to run the real video extraction test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	probe, frames, err := (ffmpegAnalyzeVideoFrameExtractor{}).Extract(ctx, videoPath, t.TempDir(), AnalyzeVideoKeyframeCount)
	require.NoError(t, err)
	assert.Greater(t, probe.Width, 0)
	assert.Greater(t, probe.Height, probe.Width, "phone portrait video should report display-oriented dimensions")
	require.Len(t, frames, AnalyzeVideoKeyframeCount)
	for index, frame := range frames {
		assert.FileExists(t, frame.Path)
		if index > 0 {
			assert.Greater(t, frame.TimestampMS, frames[index-1].TimestampMS)
		}
		score, scoreErr := analyzeVideoFrameSharpness(frame.Path)
		require.NoError(t, scoreErr)
		assert.Greater(t, score, 0.0)
		t.Logf("selected frame %d at %dms, sharpness %.2f", index+1, frame.TimestampMS, score)
	}
}
