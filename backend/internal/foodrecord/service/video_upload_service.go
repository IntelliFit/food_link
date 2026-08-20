package service

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	commonerrors "food_link/backend/internal/common/errors"
)

const (
	MaxAnalyzeVideoSizeBytes   int64   = 8 * 1024 * 1024
	MaxAnalyzeVideoDurationSec float64 = 12
	MinAnalyzeVideoDurationSec float64 = 2
	AnalyzeVideoKeyframeCount          = 5
	analyzeVideoCandidateFPS           = 4
)

type AnalyzeVideoKeyframe struct {
	Role        string `json:"role"`
	ImageURL    string `json:"image_url"`
	TimestampMS int64  `json:"timestamp_ms"`
}

type AnalyzeVideoUploadResult struct {
	CaptureProtocol string                 `json:"capture_protocol"`
	VideoID         string                 `json:"video_id"`
	DurationMS      int64                  `json:"duration_ms"`
	Width           int                    `json:"width"`
	Height          int                    `json:"height"`
	SizeBytes       int64                  `json:"size_bytes"`
	Keyframes       []AnalyzeVideoKeyframe `json:"keyframes"`
}

type extractedVideoFrame struct {
	Path        string
	TimestampMS int64
}

type videoProbeResult struct {
	DurationSeconds float64
	Width           int
	Height          int
}

type analyzeVideoFrameExtractor interface {
	Extract(ctx context.Context, videoPath, outputDir string, frameCount int) (videoProbeResult, []extractedVideoFrame, error)
}

type analyzeVideoStorage interface {
	UploadBytes(bucketAlias, key string, data []byte, contentType string) (string, error)
	DeleteObject(bucketAlias, value string) error
}

type ffmpegAnalyzeVideoFrameExtractor struct{}

func (s *UploadService) UploadAnalyzeVideo(ctx context.Context, userID, videoPath string, sizeBytes int64) (*AnalyzeVideoUploadResult, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, invalidAnalyzeVideoError("用户身份不能为空", http.StatusUnauthorized)
	}
	if strings.TrimSpace(videoPath) == "" {
		return nil, invalidAnalyzeVideoError("视频文件不能为空", http.StatusBadRequest)
	}
	if sizeBytes <= 0 {
		return nil, invalidAnalyzeVideoError("视频文件为空", http.StatusBadRequest)
	}
	if sizeBytes > MaxAnalyzeVideoSizeBytes {
		return nil, invalidAnalyzeVideoError("视频过大，最多支持 8MB", http.StatusRequestEntityTooLarge)
	}
	if s.videoExtractor == nil || s.videoStorage == nil {
		return nil, fmt.Errorf("视频关键帧服务未初始化")
	}

	outputDir, err := os.MkdirTemp("", "foodlink-video-frames-")
	if err != nil {
		return nil, fmt.Errorf("创建关键帧临时目录失败: %w", err)
	}
	defer os.RemoveAll(outputDir)

	extractCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	probe, frames, err := s.videoExtractor.Extract(extractCtx, videoPath, outputDir, AnalyzeVideoKeyframeCount)
	if err != nil {
		return nil, err
	}
	if probe.DurationSeconds < MinAnalyzeVideoDurationSec {
		return nil, invalidAnalyzeVideoError("视频过短，请至少录制 2 秒", http.StatusBadRequest)
	}
	if probe.DurationSeconds > MaxAnalyzeVideoDurationSec+0.25 {
		return nil, invalidAnalyzeVideoError("视频过长，最多支持 12 秒", http.StatusBadRequest)
	}
	if len(frames) < 3 {
		return nil, invalidAnalyzeVideoError("视频有效关键帧不足，请重新录制", http.StatusBadRequest)
	}
	if len(frames) > AnalyzeVideoKeyframeCount {
		frames = frames[:AnalyzeVideoKeyframeCount]
	}

	videoID := uuid.NewString()
	keyPrefix := fmt.Sprintf("analysis-video-frames/%s/%s", strings.TrimSpace(userID), videoID)
	uploadedURLs := make([]string, 0, len(frames))
	keyframes := make([]AnalyzeVideoKeyframe, 0, len(frames))
	cleanupUploaded := func() {
		for _, uploadedURL := range uploadedURLs {
			_ = s.videoStorage.DeleteObject("food-images", uploadedURL)
		}
	}
	for index, frame := range frames {
		data, readErr := os.ReadFile(frame.Path)
		if readErr != nil || len(data) == 0 {
			cleanupUploaded()
			if readErr != nil {
				return nil, fmt.Errorf("读取第 %d 个关键帧失败: %w", index+1, readErr)
			}
			return nil, fmt.Errorf("第 %d 个关键帧为空", index+1)
		}
		key := fmt.Sprintf("%s/frame-%02d.jpg", keyPrefix, index+1)
		imageURL, uploadErr := s.videoStorage.UploadBytes("food-images", key, data, "image/jpeg")
		if uploadErr != nil {
			cleanupUploaded()
			return nil, fmt.Errorf("上传第 %d 个关键帧失败: %w", index+1, uploadErr)
		}
		uploadedURLs = append(uploadedURLs, imageURL)
		keyframes = append(keyframes, AnalyzeVideoKeyframe{
			Role:        fmt.Sprintf("video_keyframe_%d", index+1),
			ImageURL:    imageURL,
			TimestampMS: frame.TimestampMS,
		})
	}

	return &AnalyzeVideoUploadResult{
		CaptureProtocol: "video_keyframes_v1",
		VideoID:         videoID,
		DurationMS:      int64(probe.DurationSeconds * 1000),
		Width:           probe.Width,
		Height:          probe.Height,
		SizeBytes:       sizeBytes,
		Keyframes:       keyframes,
	}, nil
}

func invalidAnalyzeVideoError(message string, status int) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: status}
}

func (ffmpegAnalyzeVideoFrameExtractor) Extract(ctx context.Context, videoPath, outputDir string, frameCount int) (videoProbeResult, []extractedVideoFrame, error) {
	if frameCount < 3 {
		frameCount = 3
	}
	probe, err := probeAnalyzeVideo(ctx, videoPath)
	if err != nil {
		return videoProbeResult{}, nil, err
	}
	if probe.DurationSeconds <= 0 || probe.Width <= 0 || probe.Height <= 0 {
		return videoProbeResult{}, nil, fmt.Errorf("无法读取视频画面信息")
	}

	candidatePattern := filepath.Join(outputDir, "candidate-%04d.jpg")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", videoPath,
		"-vf", fmt.Sprintf("fps=%d,scale=1280:-2:force_original_aspect_ratio=decrease", analyzeVideoCandidateFPS),
		"-q:v", "3",
		candidatePattern,
	}
	if output, commandErr := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); commandErr != nil {
		return videoProbeResult{}, nil, fmt.Errorf("提取候选关键帧失败: %w: %s", commandErr, strings.TrimSpace(string(output)))
	}
	candidatePaths, err := filepath.Glob(filepath.Join(outputDir, "candidate-*.jpg"))
	if err != nil {
		return videoProbeResult{}, nil, fmt.Errorf("读取候选关键帧失败: %w", err)
	}
	sort.Strings(candidatePaths)
	candidates := make([]extractedVideoFrame, 0, len(candidatePaths))
	for index, candidatePath := range candidatePaths {
		candidates = append(candidates, extractedVideoFrame{
			Path:        candidatePath,
			TimestampMS: int64(float64(index) / analyzeVideoCandidateFPS * 1000),
		})
	}
	if len(candidates) < 3 {
		return videoProbeResult{}, nil, fmt.Errorf("视频有效候选帧不足")
	}
	return probe, selectAnalyzeVideoFramesByWindow(candidates, probe.DurationSeconds, frameCount), nil
}

func selectAnalyzeVideoFramesByWindow(candidates []extractedVideoFrame, durationSeconds float64, frameCount int) []extractedVideoFrame {
	if len(candidates) <= frameCount {
		return candidates
	}
	// 忽略容易出现起手/收手抖动的首尾 6%，把其余画面分窗后各取最清晰的一帧。
	const startFraction = 0.06
	const usableFraction = 0.88
	selected := make([]extractedVideoFrame, 0, frameCount)
	for windowIndex := 0; windowIndex < frameCount; windowIndex++ {
		windowStartMS := int64(durationSeconds * (startFraction + usableFraction*float64(windowIndex)/float64(frameCount)) * 1000)
		windowEndMS := int64(durationSeconds * (startFraction + usableFraction*float64(windowIndex+1)/float64(frameCount)) * 1000)
		windowCandidates := make([]extractedVideoFrame, 0)
		for _, candidate := range candidates {
			if candidate.TimestampMS >= windowStartMS && candidate.TimestampMS < windowEndMS {
				windowCandidates = append(windowCandidates, candidate)
			}
		}
		if len(windowCandidates) > 0 {
			selected = append(selected, selectSharpestAnalyzeVideoFrame(windowCandidates))
		}
	}
	if len(selected) >= 3 {
		return selected
	}
	return candidates
}

func selectSharpestAnalyzeVideoFrame(candidates []extractedVideoFrame) extractedVideoFrame {
	if len(candidates) == 0 {
		return extractedVideoFrame{}
	}
	best := candidates[len(candidates)/2]
	bestScore := -1.0
	for _, candidate := range candidates {
		score, err := analyzeVideoFrameSharpness(candidate.Path)
		if err == nil && score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	return best
}

func analyzeVideoFrameSharpness(path string) (float64, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return 0, err
	}
	bounds := img.Bounds()
	if bounds.Dx() < 3 || bounds.Dy() < 3 {
		return 0, fmt.Errorf("关键帧尺寸过小")
	}
	step := 2
	var sum, sumSquares float64
	count := 0
	grayAt := func(x, y int) float64 {
		return float64(color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y)
	}
	for y := bounds.Min.Y + step; y < bounds.Max.Y-step; y += step {
		for x := bounds.Min.X + step; x < bounds.Max.X-step; x += step {
			laplacian := 4*grayAt(x, y) - grayAt(x-step, y) - grayAt(x+step, y) - grayAt(x, y-step) - grayAt(x, y+step)
			sum += laplacian
			sumSquares += laplacian * laplacian
			count++
		}
	}
	if count == 0 {
		return 0, fmt.Errorf("关键帧没有可评分像素")
	}
	mean := sum / float64(count)
	return sumSquares/float64(count) - mean*mean, nil
}

func probeAnalyzeVideo(ctx context.Context, videoPath string) (videoProbeResult, error) {
	args := []string{
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
		"-of", "json",
		videoPath,
	}
	output, err := exec.CommandContext(ctx, "ffprobe", args...).CombinedOutput()
	if err != nil {
		return videoProbeResult{}, fmt.Errorf("读取视频信息失败: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return parseAnalyzeVideoProbe(output)
}

func parseAnalyzeVideoProbe(output []byte) (videoProbeResult, error) {
	var payload struct {
		Streams []struct {
			Width  int `json:"width"`
			Height int `json:"height"`
			Tags   struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
			SideDataList []struct {
				Rotation int `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return videoProbeResult{}, fmt.Errorf("解析视频信息失败: %w", err)
	}
	if len(payload.Streams) == 0 {
		return videoProbeResult{}, fmt.Errorf("视频中没有可用画面")
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(payload.Format.Duration), 64)
	if err != nil {
		return videoProbeResult{}, fmt.Errorf("视频时长无效")
	}
	rotation := 0
	if len(payload.Streams[0].SideDataList) > 0 {
		rotation = payload.Streams[0].SideDataList[0].Rotation
	} else if taggedRotation, parseErr := strconv.Atoi(strings.TrimSpace(payload.Streams[0].Tags.Rotate)); parseErr == nil {
		rotation = taggedRotation
	}
	width, height := payload.Streams[0].Width, payload.Streams[0].Height
	if normalizedRotation := ((rotation % 360) + 360) % 360; normalizedRotation == 90 || normalizedRotation == 270 {
		width, height = height, width
	}
	return videoProbeResult{
		DurationSeconds: duration,
		Width:           width,
		Height:          height,
	}, nil
}
