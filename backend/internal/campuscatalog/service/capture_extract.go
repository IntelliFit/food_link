package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
)

// CaptureVisionClient is the multimodal JSON call shared by the analyze
// clients (OfoxAI/Gemini and Doubao).
type CaptureVisionClient interface {
	AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error)
}

// CaptureExtractor reads menu photos twice with independent prompts (and,
// when configured, independent models) so the checks can compare them.
type CaptureExtractor struct {
	primary  CaptureVisionClient
	verifier CaptureVisionClient
}

func NewCaptureExtractor(primary, verifier CaptureVisionClient) *CaptureExtractor {
	if verifier == nil {
		verifier = primary
	}
	return &CaptureExtractor{primary: primary, verifier: verifier}
}

// captureMaxMenuImages keeps one extraction call within model image limits.
const captureMaxMenuImages = 8

// captureExtractConcurrency bounds parallel model calls for one session.
const captureExtractConcurrency = 4

// Extract reads each menu photo separately (one call per photo and model, in
// parallel) so a long menu never hits one request's timeout. A failed primary
// read fails the whole run, because silently missing a photo would drop menu
// lines; a failed verifier read only sends that photo's items to exceptions.
func (e *CaptureExtractor) Extract(ctx context.Context, assetIDs, imageURLs []string) (*domain.CaptureExtraction, error) {
	if e == nil || e.primary == nil {
		return nil, fmt.Errorf("菜单识别服务未配置")
	}
	if len(imageURLs) == 0 || len(imageURLs) != len(assetIDs) {
		return nil, fmt.Errorf("菜单照片为空或与素材不对应")
	}
	start := time.Now()
	count := len(imageURLs)
	primaries, verifiers := make([]*capturePass, count), make([]*capturePass, count)
	primaryErrs, verifierErrs := make([]error, count), make([]error, count)
	sem := make(chan struct{}, captureExtractConcurrency)
	var wg sync.WaitGroup
	run := func(client CaptureVisionClient, prompt string, index int, out []*capturePass, errs []error) {
		defer wg.Done()
		sem <- struct{}{}
		defer func() { <-sem }()
		out[index], errs[index] = runCapturePass(ctx, client, prompt, imageURLs[index:index+1])
	}
	for index := range imageURLs {
		wg.Add(2)
		go run(e.primary, buildCapturePrimaryPrompt(1), index, primaries, primaryErrs)
		go run(e.verifier, buildCaptureVerifierPrompt(1), index, verifiers, verifierErrs)
	}
	wg.Wait()
	errorsSeen := []string{}
	for index, err := range primaryErrs {
		if err != nil {
			return nil, fmt.Errorf("第 %d 张菜单主识别失败: %w", index+1, err)
		}
	}
	failedVerifier := map[string]bool{}
	for index, err := range verifierErrs {
		if err != nil {
			failedVerifier[assetIDs[index]] = true
			errorsSeen = append(errorsSeen, fmt.Sprintf("第 %d 张菜单复核失败: %v", index+1, err))
		}
	}
	primary, verifier := mergeCapturePasses(primaries), mergeCapturePasses(verifiers)
	items := reconcileCapturePasses(assetIDs, primary, verifier)
	for index := range items {
		for _, assetID := range items[index].AssetIDs {
			if failedVerifier[assetID] {
				items[index].Reasons = uniqueStrings(append(items[index].Reasons, domain.ReasonVerifierFailed))
				items[index].Status = domain.CaptureItemException
			}
		}
	}
	now := time.Now()
	return &domain.CaptureExtraction{
		Version:     2,
		Items:       items,
		Images:      captureImageResults(assetIDs, primary, verifier),
		Models:      uniqueStrings([]string{primary.Model, modelOf(verifier)}),
		Errors:      errorsSeen,
		DurationMs:  time.Since(start).Milliseconds(),
		CompletedAt: &now,
	}, nil
}

// mergeCapturePasses re-numbers single-photo passes into one pass over all
// photos. Missing passes (failed calls) contribute nothing.
func mergeCapturePasses(passes []*capturePass) *capturePass {
	merged := &capturePass{}
	found := false
	for index, pass := range passes {
		if pass == nil {
			continue
		}
		found = true
		if merged.Model == "" {
			merged.Model = pass.Model
		}
		image := capturePassImage{Index: index, IsMenu: true, Readable: true}
		if len(pass.Images) > 0 {
			image = pass.Images[0]
			image.Index = index
		}
		merged.Images = append(merged.Images, image)
		for _, item := range pass.Items {
			item.ImageIndex = index
			merged.Items = append(merged.Items, item)
		}
	}
	if !found {
		return nil
	}
	return merged
}

func modelOf(pass *capturePass) string {
	if pass == nil {
		return ""
	}
	return pass.Model
}

// captureCallAttempts retries a slow or flaky model call once; dense menus
// can approach the client's per-request timeout.
const captureCallAttempts = 2

func runCapturePass(ctx context.Context, client CaptureVisionClient, prompt string, imageURLs []string) (*capturePass, error) {
	var raw, meta map[string]any
	var err error
	for attempt := 0; attempt < captureCallAttempts; attempt++ {
		raw, meta, err = client.AnalyzeWithImagesAndTemperatureMeta(ctx, prompt, imageURLs, 0)
		if err == nil || ctx.Err() != nil {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	pass, err := parseCapturePass(raw)
	if err != nil {
		return nil, err
	}
	if meta != nil {
		pass.Model = strings.TrimSpace(fmt.Sprint(meta["model"]))
	}
	return pass, nil
}

func captureImageResults(assetIDs []string, primary, verifier *capturePass) []domain.CaptureImageResult {
	results := make([]domain.CaptureImageResult, 0, len(assetIDs))
	for index, assetID := range assetIDs {
		result := domain.CaptureImageResult{AssetID: assetID}
		if image, ok := primary.image(index); ok {
			result.IsMenu, result.Readable = image.IsMenu, image.Readable
			result.PrimaryLines, result.UnreadableNotes = image.Lines, image.Note
		}
		if verifier != nil {
			if image, ok := verifier.image(index); ok {
				result.VerifierLines = image.Lines
				result.IsMenu = result.IsMenu || image.IsMenu
			}
		}
		results = append(results, result)
	}
	return results
}

func (p *capturePass) image(index int) (capturePassImage, bool) {
	if p == nil {
		return capturePassImage{}, false
	}
	for _, image := range p.Images {
		if image.Index == index {
			return image, true
		}
	}
	return capturePassImage{}, false
}

func buildCapturePrimaryPrompt(imageCount int) string {
	return fmt.Sprintf(`你是食堂菜单录入员。输入是同一个食堂窗口的 %d 张照片，按输入顺序编号 0 到 %d。只记录照片里真实写出的文字，不要推测、不要补全。
返回严格 JSON，不要 Markdown，不要解释：
{"images":[{"index":0,"is_menu":true,"readable":true,"note":""}],
 "items":[{"image_index":0,"name":"菜名原文","price_text":"价格原文","prices":[11],"unit":"","kind":"dish","option_groups":[{"title":"","choices":[""]}]}]}
规则：
1. images 每张照片一条，只说明是否菜单、是否看得清。
2. 每个有名称的售卖项输出一条 item。name 只写图上的菜名原文（括号内容也照抄），不要加规格、分类或口味。
3. prices 只写图上紧挨这一项的数字；有多个价格档就全部列出；没写价格就是空数组。套餐价不能写给套餐里的可选菜。
4. unit 只在图上明确写了计价单位（如 份、两、个、斤、100g）时填写；只写了“元”就留空。
5. kind：可以单独点的菜、面、饭、饮品是 dish；带“套餐、任选、几荤几素、X选一”等组合规则的是 combo，它的可选菜写进 option_groups，不要再单独输出；按重量或按份自选的配菜/原料价目（如麻辣烫、香锅配菜）是 ingredient。
6. 不是菜单的照片（环境、实物、人）is_menu=false，不要从中生成 items；看不清时 readable=false 并在 note 说明哪里看不清。
7. 不要输出荤素、辣度、份量、热量等图上没写的信息。`, imageCount, imageCount-1)
}

func buildCaptureVerifierPrompt(imageCount int) string {
	return fmt.Sprintf(`请核对 %d 张食堂菜单照片（按输入顺序编号 0 到 %d）。先完整转写每张照片上的文字，再列出能单独购买的条目。只依据照片原文。
只返回 JSON：
{"images":[{"index":0,"is_menu":true,"readable":true,"lines":["原文一行"]}],
 "entries":[{"image":0,"name":"","prices":[],"unit":"","type":"dish","options":[{"title":"","choices":[]}]}]}
要求：
- lines 逐行照抄所有可读文字（包括招牌、标题、小字、价格），每一行保持照片上的顺序。
- entries.name 与照片上的写法完全一致；prices 是这个条目自己的价格数字，多档就列多个，没有就空。
- unit 只填照片上写明的计价单位（份、两、个、斤、100g 等），只有“元”时留空。
- type 取 dish（单点）、combo（套餐/任选/几选一，其可选项放进 options）、ingredient（自选配菜或原料价目）。
- 套餐的可选菜不要单独作为 entries，也不要给它们套餐价。
- 非菜单照片 is_menu=false 且不产生 entries。`, imageCount, imageCount-1)
}

type flexibleFloats []float64

var captureNumberPattern = regexp.MustCompile(`\d+(?:\.\d+)?`)

func (f *flexibleFloats) UnmarshalJSON(data []byte) error {
	var values []any
	if err := json.Unmarshal(data, &values); err != nil {
		var single any
		if err := json.Unmarshal(data, &single); err != nil {
			return nil
		}
		values = []any{single}
	}
	out := []float64{}
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			out = append(out, typed)
		case string:
			for _, match := range captureNumberPattern.FindAllString(typed, -1) {
				if parsed, err := strconv.ParseFloat(match, 64); err == nil {
					out = append(out, parsed)
				}
			}
		}
	}
	*f = out
	return nil
}

type rawCaptureOptionGroup struct {
	Title   string   `json:"title"`
	Choices []string `json:"choices"`
}

type rawCaptureItem struct {
	ImageIndex   *int                    `json:"image_index"`
	Image        *int                    `json:"image"`
	Name         string                  `json:"name"`
	PriceText    string                  `json:"price_text"`
	Prices       flexibleFloats          `json:"prices"`
	Unit         string                  `json:"unit"`
	Kind         string                  `json:"kind"`
	Type         string                  `json:"type"`
	OptionGroups []rawCaptureOptionGroup `json:"option_groups"`
	Options      []rawCaptureOptionGroup `json:"options"`
}

type rawCaptureImage struct {
	Index    int      `json:"index"`
	IsMenu   *bool    `json:"is_menu"`
	Readable *bool    `json:"readable"`
	Lines    []string `json:"lines"`
	Note     string   `json:"note"`
}

type rawCapturePass struct {
	Images  []rawCaptureImage `json:"images"`
	Items   []rawCaptureItem  `json:"items"`
	Entries []rawCaptureItem  `json:"entries"`
}

func parseCapturePass(raw map[string]any) (*capturePass, error) {
	if raw == nil {
		return nil, fmt.Errorf("模型没有返回内容")
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var decoded rawCapturePass
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, fmt.Errorf("菜单识别结果格式不正确: %w", err)
	}
	pass := &capturePass{}
	for _, image := range decoded.Images {
		pass.Images = append(pass.Images, capturePassImage{
			Index: image.Index, IsMenu: boolOr(image.IsMenu, true), Readable: boolOr(image.Readable, true),
			Lines: image.Lines, Note: strings.TrimSpace(image.Note),
		})
	}
	for _, item := range append(decoded.Items, decoded.Entries...) {
		if strings.TrimSpace(item.Name) == "" {
			continue
		}
		imageIndex := 0
		if item.ImageIndex != nil {
			imageIndex = *item.ImageIndex
		} else if item.Image != nil {
			imageIndex = *item.Image
		}
		kind := item.Kind
		if kind == "" {
			kind = item.Type
		}
		groups := item.OptionGroups
		if len(groups) == 0 {
			groups = item.Options
		}
		converted := make([]domain.CaptureOptionGroup, 0, len(groups))
		for _, group := range groups {
			converted = append(converted, domain.CaptureOptionGroup{Title: group.Title, Choices: group.Choices})
		}
		pass.Items = append(pass.Items, capturePassItem{
			ImageIndex: imageIndex, Name: item.Name, PriceText: item.PriceText, Prices: item.Prices,
			Unit: item.Unit, Kind: kind, OptionGroups: converted,
		})
	}
	return pass, nil
}

func boolOr(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

// ApplyCaptureWindowType exposes the window-type rule to offline evaluation.
func ApplyCaptureWindowType(items []domain.CaptureItem, serviceMode string) []domain.CaptureItem {
	return applyCaptureServiceMode(items, serviceMode)
}
