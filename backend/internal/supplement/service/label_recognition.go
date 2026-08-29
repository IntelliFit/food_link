package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/nutrition"
	"food_link/backend/internal/supplement/domain"
	"food_link/backend/pkg/logger"
)

const maxSupplementLabelImages = 3

type LabelVisionClient interface {
	AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error)
}

type LabelRecognitionResult struct {
	Name         string             `json:"name"`
	Brand        string             `json:"brand"`
	ServingLabel string             `json:"serving_label"`
	Components   []domain.Component `json:"components"`
	Confidence   float64            `json:"confidence"`
	RawText      string             `json:"raw_text,omitempty"`
}

type rawLabelRecognition struct {
	Name         string             `json:"name"`
	ProductName  string             `json:"product_name"`
	Brand        string             `json:"brand"`
	ServingLabel string             `json:"serving_label"`
	Components   []domain.Component `json:"components"`
	Confidence   float64            `json:"confidence"`
	RawText      string             `json:"raw_text"`
}

func (s *SupplementService) ConfigureLabelVisionClient(client LabelVisionClient) {
	s.labelVisionClient = client
}

func (s *SupplementService) RecognizeLabel(ctx context.Context, imageURLs []string) (*LabelRecognitionResult, error) {
	imageURLs = normalizeLabelImageURLs(imageURLs)
	if len(imageURLs) == 0 {
		return nil, badRequest("请至少上传 1 张补剂标签图片")
	}
	if len(imageURLs) > maxSupplementLabelImages {
		return nil, badRequest("同一种补剂最多上传 3 张标签图片")
	}
	if s.labelVisionClient == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "补剂标签识别服务未配置", HTTPStatus: http.StatusInternalServerError}
	}

	raw, err := s.labelVisionClient.AnalyzeWithImagesAndTemperature(ctx, buildSupplementLabelPrompt(len(imageURLs)), imageURLs, 0.1)
	if err != nil {
		logger.Error(ctx, "补剂标签多图识别失败", err, slog.Int("image_count", len(imageURLs)))
		return nil, fmt.Errorf("识别补剂标签失败: %w", err)
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("序列化补剂标签识别结果失败: %w", err)
	}
	var parsed rawLabelRecognition
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return nil, fmt.Errorf("解析补剂标签识别结果失败: %w", err)
	}

	components := normalizeRecognizedLabelComponents(parsed.Components)
	if len(components) == 0 {
		return nil, badRequest("未识别到有效补剂成分，请补拍清晰的成分表或 Supplement Facts")
	}
	name := strings.TrimSpace(parsed.Name)
	if name == "" {
		name = strings.TrimSpace(parsed.ProductName)
	}
	servingLabel := strings.TrimSpace(parsed.ServingLabel)
	if servingLabel == "" {
		servingLabel = "1份"
	}
	result := &LabelRecognitionResult{
		Name: name, Brand: strings.TrimSpace(parsed.Brand), ServingLabel: servingLabel,
		Components: components, Confidence: parsed.Confidence, RawText: strings.TrimSpace(parsed.RawText),
	}
	logger.Info(ctx, "补剂标签多图识别完成", slog.Int("image_count", len(imageURLs)), slog.Int("component_count", len(components)), slog.Bool("has_name", name != ""))
	return result, nil
}

func normalizeLabelImageURLs(input []string) []string {
	result := make([]string, 0, len(input))
	seen := map[string]bool{}
	for _, item := range input {
		value := strings.TrimSpace(item)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func normalizeRecognizedLabelComponents(input []domain.Component) []domain.Component {
	knownKeys := map[string]bool{}
	for _, cfg := range nutrition.MicroNutrientConfigs {
		knownKeys[cfg.Key] = true
	}
	result := make([]domain.Component, 0, len(input))
	for _, item := range input {
		item.Name = strings.TrimSpace(item.Name)
		item.Unit = strings.TrimSpace(item.Unit)
		item.Form = strings.TrimSpace(item.Form)
		item.Category = strings.ToLower(strings.TrimSpace(item.Category))
		item.NutrientKey = strings.TrimSpace(item.NutrientKey)
		if item.NutrientKey == "" {
			item.NutrientKey = recognizedNutrientKey(item.Name)
		} else if !knownKeys[item.NutrientKey] {
			item.NutrientKey = recognizedNutrientKey(item.Name)
		}
		if item.Category == "" {
			if item.NutrientKey != "" {
				item.Category = domain.ComponentCategoryNutrient
			} else {
				item.Category = domain.ComponentCategoryFunctional
			}
		}
		switch item.Category {
		case domain.ComponentCategoryNutrient:
			if !knownKeys[item.NutrientKey] {
				item.NutrientKey = ""
			} else if !normalizeRecognizedNutrientUnit(&item) {
				// Preserve the label amount, but do not add it to a canonical
				// nutrition progress bar when its unit cannot be converted safely.
				item.NutrientKey = ""
			}
		case domain.ComponentCategoryFunctional, domain.ComponentCategoryBlend:
			item.NutrientKey = ""
		default:
			item.Category = domain.ComponentCategoryFunctional
			item.NutrientKey = ""
		}
		item.Code = normalizeCode(item.Code, item.Name)
		if item.Name == "" || item.Code == "" || item.Amount <= 0 || item.Unit == "" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func normalizeRecognizedNutrientUnit(item *domain.Component) bool {
	if item == nil || item.NutrientKey == "" {
		return false
	}
	unit := normalizeLabelUnit(item.Unit)
	if item.NutrientKey == "vitaminDMcg" && unit == "iu" {
		item.Amount /= 40
		item.Unit = "mcg"
		return true
	}
	cfg := nutrition.MicroNutrientConfigByKey(item.NutrientKey)
	canonical := normalizeLabelUnit(cfg.Unit)
	if canonical == "" {
		return false
	}
	if unit == canonical {
		item.Unit = canonicalDisplayUnit(cfg.Unit)
		return true
	}
	toGrams := map[string]float64{"g": 1, "mg": 0.001, "mcg": 0.000001}
	from, fromOK := toGrams[unit]
	to, toOK := toGrams[canonical]
	if !fromOK || !toOK {
		return false
	}
	item.Amount = item.Amount * from / to
	item.Unit = canonicalDisplayUnit(cfg.Unit)
	return true
}

func normalizeLabelUnit(unit string) string {
	value := strings.ToLower(strings.TrimSpace(unit))
	value = strings.NewReplacer("μ", "u", "µ", "u", " ", "", ".", "").Replace(value)
	switch value {
	case "ug", "mcgrae", "mcg_rae":
		return "mcg"
	case "internationalunit", "internationalunits", "国际单位":
		return "iu"
	default:
		return value
	}
}

func canonicalDisplayUnit(unit string) string {
	if normalizeLabelUnit(unit) == "mcg" {
		return "mcg"
	}
	return strings.TrimSpace(unit)
}

func recognizedNutrientKey(name string) string {
	normalized := strings.ToLower(strings.NewReplacer(" ", "", "-", "", "_", "", "（", "", "）", "", "(", "", ")", "").Replace(strings.TrimSpace(name)))
	aliases := map[string]string{
		"膳食纤维": "fiber", "糖": "sugar", "饱和脂肪": "saturatedFat", "胆固醇": "cholesterolMg",
		"钠": "sodiumMg", "钾": "potassiumMg", "钙": "calciumMg", "铁": "ironMg", "镁": "magnesiumMg", "锌": "zincMg",
		"维生素a": "vitaminARaeMcg", "维a": "vitaminARaeMcg", "vitamina": "vitaminARaeMcg",
		"维生素c": "vitaminCMg", "维c": "vitaminCMg", "vitaminc": "vitaminCMg",
		"维生素d": "vitaminDMcg", "维生素d3": "vitaminDMcg", "维d": "vitaminDMcg", "维d3": "vitaminDMcg", "vitamind": "vitaminDMcg", "vitamind3": "vitaminDMcg",
		"维生素e": "vitaminEMg", "维e": "vitaminEMg", "vitamine": "vitaminEMg",
		"维生素k": "vitaminKMcg", "维k": "vitaminKMcg", "vitamink": "vitaminKMcg",
		"维生素b1": "thiaminMg", "维b1": "thiaminMg", "硫胺素": "thiaminMg",
		"维生素b2": "riboflavinMg", "维b2": "riboflavinMg", "核黄素": "riboflavinMg",
		"烟酸": "niacinMg", "维生素b3": "niacinMg", "维b3": "niacinMg",
		"维生素b6": "vitaminB6Mg", "维b6": "vitaminB6Mg", "叶酸": "folateMcg",
		"维生素b12": "vitaminB12Mcg", "维b12": "vitaminB12Mcg",
	}
	return aliases[normalized]
}

func buildSupplementLabelPrompt(imageCount int) string {
	return fmt.Sprintf(`你是补剂瓶身和 Supplement Facts 标签的多图 OCR 结构化提取助手。现在有 %d 张同一种补剂的互补图片，通常是包装正面、成分表、配料或服用说明。
必须把所有图片理解为同一个商品，不要拆成多个商品。只读取图片真实出现的名称、品牌、每份用量和成分，不要根据常识补齐或推荐剂量。
补剂没有热量、蛋白质、碳水或脂肪完全正常，不能因此判定识别失败。
components 中的 amount 必须是标签声明的“每份”含量；unit 保留标签单位并规范为 g、mg、mcg、IU、CFU 等。没有明确含量的单项不要伪造。
category 规则：
- nutrient：维生素、矿物质及当前标准营养素；尽量填写对应 nutrient_key。
- functional：EPA、DHA、肌酸、辅酶Q10、茶氨酸、咖啡因、氨基酸、植物提取物等有独立含量的功能成分。
- blend：标签只披露复合配方总量、未披露各单项含量时，只记录配方总量，不拆分猜测。
可用 nutrient_key：fiber、sugar、saturatedFat、cholesterolMg、sodiumMg、potassiumMg、calciumMg、ironMg、magnesiumMg、zincMg、vitaminARaeMcg、vitaminCMg、vitaminDMcg、vitaminEMg、vitaminKMcg、thiaminMg、riboflavinMg、niacinMg、vitaminB6Mg、folateMcg、vitaminB12Mcg。
例如维生素D3应映射为 nutrient_key=vitaminDMcg，EPA/DHA和肌酸不得映射为维生素或矿物质。
返回严格 JSON，不要 Markdown：
{
  "name": "商品名称",
  "brand": "品牌",
  "serving_label": "如1粒、2粒、1勺",
  "components": [
    {"code":"vitamin_d","name":"维生素D3","category":"nutrient","amount":25,"unit":"mcg","nutrient_key":"vitaminDMcg","form":"D3"},
    {"code":"epa","name":"EPA","category":"functional","amount":180,"unit":"mg"}
  ],
  "confidence": 0,
  "raw_text": "关键标签原文"
}`, imageCount)
}
