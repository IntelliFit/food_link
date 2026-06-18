package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"food_link/backend/pkg/config"
)

const (
	defaultInputRelPath  = "data/goose_duck_chicken_benchmark.csv"
	defaultPromptText    = "你是一个只做三分类的熟食腿类鉴别器，只允许在 goose、duck、chicken 三者中选择一个主类别。请忽略摆盘文案和菜谱标题，只根据图片视觉内容判断。如果是整只烤禽，也仍然在 goose、duck、chicken 中选最可能的物种。返回 JSON：{\"species\":\"goose|duck|chicken\",\"confidence\":0-1,\"reason\":\"<=30字\"}"
	defaultModelsCSV     = "gpt-5.5:stable,gpt-5.4-pro:stable,gpt-5.4-mini:stable"
	defaultOutputSubdir  = "goose-duck-chicken-benchmark"
	defaultOpenAIBaseURL = "https://yunwu.ai/v1"
)

type benchmarkCase struct {
	Label    string `json:"label"`
	Expected string `json:"expected"`
	ImageURL string `json:"image_url"`
	Notes    string `json:"notes,omitempty"`
}

type modelResult struct {
	Label      string  `json:"label"`
	Expected   string  `json:"expected"`
	Predicted  string  `json:"predicted,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Reason     string  `json:"reason,omitempty"`
	Pass       bool    `json:"pass"`
	Error      string  `json:"error,omitempty"`
	RawContent string  `json:"raw_content,omitempty"`
}

type modelSummary struct {
	Model        string        `json:"model"`
	Total        int           `json:"total"`
	Passed       int           `json:"passed"`
	Accuracy     float64       `json:"accuracy"`
	AvgLatencyMS float64       `json:"avg_latency_ms"`
	Results      []modelResult `json:"results"`
}

type benchmarkReport struct {
	GeneratedAt string         `json:"generated_at"`
	BaseURL     string         `json:"base_url"`
	InputPath   string         `json:"input_path"`
	Models      []modelSummary `json:"models"`
	Prompt      string         `json:"prompt"`
}

type chatRequest struct {
	Model          string  `json:"model"`
	Messages       []any   `json:"messages"`
	ResponseFormat any     `json:"response_format,omitempty"`
	Temperature    float64 `json:"temperature"`
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type classifyResponse struct {
	Species    string  `json:"species"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	inputPath := flag.String("input", resolveDefaultCSVPath(), "benchmark CSV path")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for benchmark reports")
	modelsCSV := flag.String("models", defaultModelsCSV, "comma separated model list")
	baseURLFlag := flag.String("base-url", "", "OpenAI-compatible base URL; empty uses config or default")
	apiKeyFlag := flag.String("api-key", "", "OpenAI-compatible API key; empty uses config")
	promptText := flag.String("prompt", defaultPromptText, "classification prompt")
	timeout := flag.Duration("timeout", 15*time.Minute, "command timeout")
	perRequestTimeout := flag.Duration("request-timeout", 120*time.Second, "single request timeout")
	temperature := flag.Float64("temperature", 0.1, "request temperature")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	_ = resolvedDir

	baseURL := strings.TrimSpace(*baseURLFlag)
	if baseURL == "" {
		baseURL = strings.TrimSpace(cfg.External.OfoxAIBaseURL)
	}
	if baseURL == "" {
		baseURL = defaultOpenAIBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	apiKey := strings.TrimSpace(*apiKeyFlag)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.External.OfoxAIAPIKey)
	}
	if apiKey == "" {
		log.Fatal("缺少 API key：请传 --api-key 或在配置里设置 external.ofoxai_api_key")
	}

	models := splitCSV(*modelsCSV)
	if len(models) == 0 {
		log.Fatal("--models 不能为空")
	}
	cases, err := readBenchmarkCSV(*inputPath)
	if err != nil {
		log.Fatalf("读取 benchmark CSV 失败: %v", err)
	}

	client := &http.Client{Timeout: *perRequestTimeout}
	report := benchmarkReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		BaseURL:     baseURL,
		InputPath:   *inputPath,
		Prompt:      *promptText,
		Models:      make([]modelSummary, 0, len(models)),
	}

	for _, model := range models {
		summary := modelSummary{
			Model:   model,
			Total:   len(cases),
			Results: make([]modelResult, 0, len(cases)),
		}
		var totalLatency time.Duration
		for _, item := range cases {
			start := time.Now()
			result, err := classifyImage(ctx, client, baseURL, apiKey, model, *promptText, item.ImageURL, *temperature)
			latency := time.Since(start)
			totalLatency += latency
			row := modelResult{
				Label:    item.Label,
				Expected: item.Expected,
			}
			if err != nil {
				row.Error = err.Error()
				summary.Results = append(summary.Results, row)
				continue
			}
			row.Predicted = result.Species
			row.Confidence = result.Confidence
			row.Reason = result.Reason
			row.RawContent = result.RawContent
			row.Pass = strings.EqualFold(result.Species, item.Expected)
			if row.Pass {
				summary.Passed++
			}
			summary.Results = append(summary.Results, row)
		}
		if summary.Total > 0 {
			summary.Accuracy = float64(summary.Passed) / float64(summary.Total)
			summary.AvgLatencyMS = float64(totalLatency.Milliseconds()) / float64(summary.Total)
		}
		report.Models = append(report.Models, summary)
	}

	sort.Slice(report.Models, func(i, j int) bool {
		if report.Models[i].Accuracy == report.Models[j].Accuracy {
			return report.Models[i].AvgLatencyMS < report.Models[j].AvgLatencyMS
		}
		return report.Models[i].Accuracy > report.Models[j].Accuracy
	})

	jsonPath, mdPath, err := writeReports(*outputDir, report)
	if err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	best := report.Models[0]
	fmt.Printf("goose duck chicken benchmark best_model=%s accuracy=%.4f passed=%d/%d avg_latency_ms=%.1f reports=%s,%s\n",
		best.Model, best.Accuracy, best.Passed, best.Total, best.AvgLatencyMS, jsonPath, mdPath)
}

type classifyResult struct {
	Species    string
	Confidence float64
	Reason     string
	RawContent string
}

func classifyImage(ctx context.Context, client *http.Client, baseURL, apiKey, model, promptText, imageURL string, temperature float64) (*classifyResult, error) {
	body := map[string]any{
		"model": model,
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": promptText},
				{"type": "image_url", "image_url": map[string]string{"url": imageURL}},
			},
		}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     temperature,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New(strings.TrimSpace(string(data)))
	}

	var parsed chatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, errors.New("empty choices")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	jsonText := extractJSONObject(content)
	var classify classifyResponse
	if err := json.Unmarshal([]byte(jsonText), &classify); err != nil {
		return nil, fmt.Errorf("parse model json failed: %w; raw=%s", err, content)
	}
	classify.Species = normalizeSpecies(classify.Species)
	return &classifyResult{
		Species:    classify.Species,
		Confidence: classify.Confidence,
		Reason:     classify.Reason,
		RawContent: content,
	}, nil
}

func normalizeSpecies(species string) string {
	s := strings.ToLower(strings.TrimSpace(species))
	switch s {
	case "goose", "鹅":
		return "goose"
	case "duck", "鸭":
		return "duck"
	case "chicken", "鸡":
		return "chicken"
	default:
		return s
	}
}

func extractJSONObject(raw string) string {
	raw = strings.TrimSpace(raw)
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start >= 0 && end > start {
		return raw[start : end+1]
	}
	return raw
}

func readBenchmarkCSV(path string) ([]benchmarkCase, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	rows, err := csv.NewReader(file).ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("benchmark csv 至少需要表头和一行数据")
	}

	out := make([]benchmarkCase, 0, len(rows)-1)
	for i, row := range rows[1:] {
		if len(row) < 3 {
			return nil, fmt.Errorf("第 %d 行列数不足", i+2)
		}
		item := benchmarkCase{
			Label:    strings.TrimSpace(row[0]),
			Expected: normalizeSpecies(row[1]),
			ImageURL: strings.TrimSpace(row[2]),
		}
		if len(row) > 3 {
			item.Notes = strings.TrimSpace(row[3])
		}
		if item.Label == "" || item.Expected == "" || item.ImageURL == "" {
			return nil, fmt.Errorf("第 %d 行存在空字段", i+2)
		}
		out = append(out, item)
	}
	return out, nil
}

func writeReports(outputDir string, report benchmarkReport) (string, string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", "", err
	}
	ts := time.Now().Format("20060102-150405")
	jsonPath := filepath.Join(outputDir, "goose_duck_chicken_benchmark_"+ts+".json")
	mdPath := filepath.Join(outputDir, "goose_duck_chicken_benchmark_"+ts+".md")

	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(jsonPath, raw, 0o644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(mdPath, []byte(renderMarkdown(report)), 0o644); err != nil {
		return "", "", err
	}
	return jsonPath, mdPath, nil
}

func renderMarkdown(report benchmarkReport) string {
	var b strings.Builder
	b.WriteString("# Goose Duck Chicken Benchmark\n\n")
	b.WriteString("- Generated at: " + report.GeneratedAt + "\n")
	b.WriteString("- Base URL: `" + report.BaseURL + "`\n")
	b.WriteString("- Input: `" + report.InputPath + "`\n\n")
	b.WriteString("## Summary\n\n")
	b.WriteString("| Model | Passed | Total | Accuracy | Avg Latency (ms) |\n")
	b.WriteString("| --- | ---: | ---: | ---: | ---: |\n")
	for _, m := range report.Models {
		b.WriteString(fmt.Sprintf("| `%s` | %d | %d | %.2f%% | %.1f |\n", m.Model, m.Passed, m.Total, m.Accuracy*100, m.AvgLatencyMS))
	}
	for _, m := range report.Models {
		b.WriteString("\n## " + m.Model + "\n\n")
		b.WriteString("| Label | Expected | Predicted | Pass | Confidence | Reason |\n")
		b.WriteString("| --- | --- | --- | --- | ---: | --- |\n")
		for _, r := range m.Results {
			predicted := r.Predicted
			if predicted == "" {
				predicted = "ERROR"
			}
			reason := strings.ReplaceAll(r.Reason, "|", "/")
			if r.Error != "" {
				reason = strings.ReplaceAll(r.Error, "|", "/")
			}
			pass := "no"
			if r.Pass {
				pass = "yes"
			}
			b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %.2f | %s |\n",
				r.Label, r.Expected, predicted, pass, r.Confidence, reason))
		}
	}
	return b.String()
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		out = append(out, part)
	}
	return out
}

func resolveDefaultCSVPath() string {
	if _, err := os.Stat(defaultInputRelPath); err == nil {
		return defaultInputRelPath
	}
	rootPath := filepath.Join("backend", defaultInputRelPath)
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath
	}
	return defaultInputRelPath
}

func resolveDefaultOutputDir() string {
	if base, err := os.Getwd(); err == nil && filepath.Base(base) == "backend" {
		return filepath.Join("..", "tmp", defaultOutputSubdir)
	}
	return filepath.Join("tmp", defaultOutputSubdir)
}

func loadConfig(configDir string) (*config.Config, string, error) {
	candidates := []string{configDir}
	if configDir == "." {
		candidates = append(candidates, "backend", filepath.Join("food_link", "backend"), filepath.Join("..", ".."))
	}
	var firstErr error
	for _, dir := range candidates {
		cfg, err := config.Load(dir)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if hasConfigFile(dir) {
			return cfg, dir, nil
		}
	}
	if firstErr != nil {
		return nil, "", firstErr
	}
	return nil, "", fmt.Errorf("config file not found")
}

func hasConfigFile(dir string) bool {
	for _, name := range []string{"app-config.yaml", "config.yaml", ".env"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}
