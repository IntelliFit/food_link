// Command canteen-capture-eval measures the window capture menu reader on
// hand-labelled local photos before auto-publishing is trusted. It calls the
// configured vision models (costs model tokens) but never touches the
// database. The truth file lists, per window, the photos and every item a
// careful human reads from them; unknown units and sizes are left empty.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/campuscatalog/domain"
	catalogservice "food_link/backend/internal/campuscatalog/service"
	"food_link/backend/pkg/config"
)

type truthItem struct {
	Name   string    `json:"name"`
	Prices []float64 `json:"prices"`
	Kind   string    `json:"kind"`
}

type truthCase struct {
	Window string      `json:"window"`
	Photos []string    `json:"photos"`
	Items  []truthItem `json:"items"`
}

// urlRewriter lets one extractor serve two providers: Gemini native requests
// download the local HTTP URL themselves, OpenAI-style providers get inline
// data because they cannot reach this machine.
type urlRewriter struct {
	inner   catalogservice.CaptureVisionClient
	rewrite map[string]string
}

func (u urlRewriter) AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, urls []string, temperature float64) (map[string]any, map[string]any, error) {
	mapped := make([]string, 0, len(urls))
	for _, url := range urls {
		if replacement, ok := u.rewrite[url]; ok {
			url = replacement
		}
		mapped = append(mapped, url)
	}
	return u.inner.AnalyzeWithImagesAndTemperatureMeta(ctx, prompt, mapped, temperature)
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	photosDir := flag.String("photos", "", "folder with the labelled photos")
	truthPath := flag.String("truth", "", "truth JSON file")
	reportPath := flag.String("report", "", "optional JSON report path")
	only := flag.String("only", "", "evaluate only this window")
	verifierFlag := flag.String("verifier", "dashscope", "verifier model client: dashscope or doubao")
	flag.Parse()
	if *photosDir == "" || *truthPath == "" {
		log.Fatal("必须指定 -photos 和 -truth")
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	gemini := analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, "gemini-3-flash-preview", cfg.External.OfoxAIBaseURL)
	primaryName := "gemini-3-flash-preview"
	if strings.TrimSpace(cfg.External.Gemini35APIKey) != "" && strings.TrimSpace(cfg.External.Gemini35BaseURL) != "" {
		gemini, primaryName = analyzeservice.NewOfoxAIClient(cfg.External.Gemini35APIKey, "gemini-3.5-flash", cfg.External.Gemini35BaseURL), "gemini-3.5-flash"
	}
	var verifier catalogservice.CaptureVisionClient
	verifierName := *verifierFlag
	switch verifierName {
	case "doubao":
		verifier = analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, "", cfg.External.DoubaoBaseURL)
	default:
		verifierName = "dashscope qwen"
		verifier = analyzeservice.NewDashScopeClient(cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL)
	}
	cases := []truthCase{}
	data, err := os.ReadFile(*truthPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		log.Fatalf("解析标注文件失败: %v", err)
	}
	// The Gemini client only downloads HTTPS images, so the photos are served
	// over local TLS whose certificate is trusted inside this process only.
	server := httptest.NewUnstartedServer(http.FileServer(http.Dir(*photosDir)))
	server.StartTLS()
	defer server.Close()
	pool, err := x509.SystemCertPool()
	if err != nil {
		log.Fatalf("读取系统证书失败: %v", err)
	}
	pool.AddCert(server.Certificate())
	photoClient := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
	}}
	base := server.URL + "/"
	gemini.SetImageHTTPClient(photoClient)
	var primary catalogservice.CaptureVisionClient = gemini
	log.Printf("主识别模型 %s，复核模型 %s；样本 %d 个窗口", primaryName, verifierName, len(cases))

	report := []map[string]any{}
	totals := map[string]int{}
	for _, item := range cases {
		if *only != "" && item.Window != *only {
			continue
		}
		result := evaluate(item, base, *photosDir, primary, verifier)
		report = append(report, result)
		for _, key := range []string{"truth", "passed", "passed_correct", "passed_wrong", "exceptions", "found_any", "missed"} {
			totals[key] += result[key].(int)
		}
	}
	fmt.Printf("\n合计：标注条目 %d；自动通过 %d，其中正确 %d、错误 %d；进入异常 %d；两遍都没读出 %d\n",
		totals["truth"], totals["passed"], totals["passed_correct"], totals["passed_wrong"], totals["exceptions"], totals["missed"])
	if totals["passed"] > 0 {
		fmt.Printf("自动通过正确率 %.1f%%；自动通过覆盖 %.1f%% 的标注条目\n",
			100*float64(totals["passed_correct"])/float64(totals["passed"]), 100*float64(totals["passed_correct"])/float64(totals["truth"]))
	}
	if *reportPath != "" {
		out, _ := json.MarshalIndent(map[string]any{"cases": report, "totals": totals, "primary": primaryName}, "", "  ")
		if err := os.WriteFile(*reportPath, out, 0o644); err != nil {
			log.Fatal(err)
		}
	}
}

func evaluate(item truthCase, base, photosDir string, primary, verifier catalogservice.CaptureVisionClient) map[string]any {
	urls, rewrite := []string{}, map[string]string{}
	for _, photo := range item.Photos {
		url := base + photo
		urls = append(urls, url)
		raw, err := os.ReadFile(filepath.Join(photosDir, photo))
		if err != nil {
			log.Fatalf("读取照片失败 %s: %v", photo, err)
		}
		rewrite[url] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(raw)
	}
	extractor := catalogservice.NewCaptureExtractor(primary, urlRewriter{inner: verifier, rewrite: rewrite})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	extraction, err := extractor.Extract(ctx, item.Photos, urls)
	if err != nil {
		log.Printf("[%s] 识别失败: %v", item.Window, err)
		return map[string]any{"window": item.Window, "error": err.Error(), "truth": len(item.Items), "passed": 0,
			"passed_correct": 0, "passed_wrong": 0, "exceptions": 0, "found_any": 0, "missed": len(item.Items)}
	}
	matched := map[int]bool{}
	passed, correct, wrong, exceptions, foundAny := 0, 0, 0, 0, 0
	lines := []string{}
	for _, extracted := range extraction.Items {
		truthIndex := matchTruth(item.Items, extracted)
		status := "错误"
		if truthIndex >= 0 {
			status = "正确"
			if !matched[truthIndex] {
				matched[truthIndex] = true
				foundAny++
			}
		}
		if extracted.Status == domain.CaptureItemPassed {
			passed++
			if truthIndex >= 0 {
				correct++
			} else {
				wrong++
			}
			lines = append(lines, fmt.Sprintf("  通过 %s %s %v %s", status, extracted.Name, extracted.Prices, extracted.Kind))
		} else {
			exceptions++
			lines = append(lines, fmt.Sprintf("  异常 %s %s %v %s %v", status, extracted.Name, extracted.Prices, extracted.Kind, extracted.Reasons))
		}
	}
	missed := []string{}
	for index, truth := range item.Items {
		if !matched[index] {
			missed = append(missed, fmt.Sprintf("%s%v", truth.Name, truth.Prices))
		}
	}
	sort.Strings(lines)
	fmt.Printf("\n[%s] 标注 %d，通过 %d（正确 %d，错误 %d），异常 %d，漏读 %d，耗时 %dms\n",
		item.Window, len(item.Items), passed, correct, wrong, exceptions, len(missed), extraction.DurationMs)
	for _, line := range lines {
		fmt.Println(line)
	}
	if len(missed) > 0 {
		fmt.Printf("  漏读：%s\n", strings.Join(missed, "、"))
	}
	for _, message := range extraction.Errors {
		fmt.Printf("  模型错误：%s\n", truncate(message, 300))
	}
	return map[string]any{"window": item.Window, "truth": len(item.Items), "passed": passed, "passed_correct": correct,
		"passed_wrong": wrong, "exceptions": exceptions, "found_any": foundAny, "missed": len(missed),
		"missed_items": missed, "items": extraction.Items, "images": extraction.Images, "models": extraction.Models}
}

// matchTruth requires the same name (ignoring spaces and full-width marks),
// the same prices and the same kind; anything else counts as wrong.
func matchTruth(truth []truthItem, extracted domain.CaptureItem) int {
	for index, item := range truth {
		if normalize(item.Name) != normalize(extracted.Name) || len(item.Prices) != len(extracted.Prices) {
			continue
		}
		prices := append([]float64{}, item.Prices...)
		sort.Float64s(prices)
		same := true
		for i := range prices {
			if math.Abs(prices[i]-extracted.Prices[i]) > 0.001 {
				same = false
			}
		}
		kind := item.Kind
		if kind == "" {
			kind = domain.CaptureKindDish
		}
		if same && kind == extracted.Kind {
			return index
		}
	}
	return -1
}

func normalize(value string) string {
	replacer := strings.NewReplacer(" ", "", "　", "", "（", "(", "）", ")")
	return strings.ToLower(replacer.Replace(strings.TrimSpace(value)))
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
