package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
)

const aliasReviewDefaultModel = "deepseek-v4-pro"

type NutritionAliasReviewRepo interface {
	List(ctx context.Context, input repo.ListNutritionAliasCandidatesInput) (*repo.ListNutritionAliasCandidatesResult, error)
	Get(ctx context.Context, id string) (*repo.NutritionAliasCandidate, error)
	Create(ctx context.Context, input repo.CreateNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error)
	SaveAIReview(ctx context.Context, id string, update repo.AliasAIReviewUpdate) (*repo.NutritionAliasCandidate, error)
	Review(ctx context.Context, id, decision, reviewerID, note string) (*repo.NutritionAliasCandidate, error)
}

type AliasAIReviewer interface {
	Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error)
}

type NutritionAliasReviewService struct {
	repo     NutritionAliasReviewRepo
	reviewer AliasAIReviewer
	model    string
}

func NewNutritionAliasReviewService(reviewRepo NutritionAliasReviewRepo, reviewer AliasAIReviewer, model string) *NutritionAliasReviewService {
	model = strings.TrimSpace(model)
	if model == "" {
		model = aliasReviewDefaultModel
	}
	return &NutritionAliasReviewService{repo: reviewRepo, reviewer: reviewer, model: model}
}

type ListNutritionAliasCandidatesInput struct {
	Query  string `form:"q"`
	Status string `form:"status"`
	Source string `form:"source"`
	Page   int    `form:"page"`
	Limit  int    `form:"limit"`
}

type CreateNutritionAliasCandidateInput struct {
	AliasName      string  `json:"alias_name" binding:"required"`
	ProposedFoodID string  `json:"proposed_food_id" binding:"required"`
	SourceTaskID   *string `json:"source_task_id"`
	Note           string  `json:"note"`
}

type ReviewNutritionAliasCandidateInput struct {
	Decision string `json:"decision" binding:"required"`
	Note     string `json:"note"`
}

type BatchAIReviewInput struct {
	Limit int `json:"limit"`
}

type BatchAIReviewResult struct {
	Requested int      `json:"requested"`
	Succeeded int      `json:"succeeded"`
	Failed    int      `json:"failed"`
	Errors    []string `json:"errors"`
}

func (s *NutritionAliasReviewService) List(ctx context.Context, input ListNutritionAliasCandidatesInput) (*repo.ListNutritionAliasCandidatesResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	return s.repo.List(ctx, repo.ListNutritionAliasCandidatesInput{
		Query: input.Query, Status: input.Status, Source: input.Source,
		Limit: limit, Offset: (page - 1) * limit,
	})
}

func (s *NutritionAliasReviewService) Get(ctx context.Context, id string) (*repo.NutritionAliasCandidate, error) {
	return s.repo.Get(ctx, strings.TrimSpace(id))
}

func (s *NutritionAliasReviewService) Create(ctx context.Context, input CreateNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error) {
	aliasName := strings.TrimSpace(input.AliasName)
	foodID := strings.TrimSpace(input.ProposedFoodID)
	if aliasName == "" || foodID == "" {
		return nil, badAliasRequest("别名和目标食物不能为空")
	}
	if utf8.RuneCountInString(aliasName) > 80 {
		return nil, badAliasRequest("别名不能超过 80 个字符")
	}
	item, err := s.repo.Create(ctx, repo.CreateNutritionAliasCandidateInput{
		AliasName: aliasName, ProposedFoodID: foodID, Source: "admin_manual", SourceTaskID: input.SourceTaskID,
	})
	if err != nil {
		return nil, badAliasRequest(err.Error())
	}
	return item, nil
}

func (s *NutritionAliasReviewService) AIReview(ctx context.Context, id string) (*repo.NutritionAliasCandidate, int, error) {
	if s.reviewer == nil {
		return nil, 0, &commonerrors.AppError{Code: 10003, Message: "AI 审核未配置，请检查 DeepSeek API Key", HTTPStatus: 503}
	}
	candidate, err := s.repo.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, 0, err
	}
	if candidate.Status != repo.AliasCandidatePending {
		return nil, 0, badAliasRequest("只有待审核候选可以执行 AI 预审")
	}
	prompt := buildAliasReviewPrompt(candidate)
	result, err := s.reviewer.Analyze(ctx, prompt, "")
	if err != nil {
		return nil, 0, fmt.Errorf("%s 预审失败: %w", s.model, err)
	}
	decision := normalizeAIDecision(stringValue(result["decision"]))
	confidence := clampConfidence(numberValue(result["confidence"]))
	reason := strings.TrimSpace(stringValue(result["reason"]))
	if reason == "" {
		reason = "模型未提供理由，必须人工复核"
		decision = "manual_review"
	}
	suggestedAliases := normalizeSuggestedAliases(result["suggestedAliases"], candidate)
	riskFlags := normalizeStringList(result["riskFlags"], 10)
	if decision != "approve" {
		suggestedAliases = nil
	}
	updated, err := s.repo.SaveAIReview(ctx, candidate.ID, repo.AliasAIReviewUpdate{
		Model: s.model, Decision: decision, Confidence: confidence, Reason: reason,
		SuggestedAliases: suggestedAliases, RuleFlags: riskFlags,
	})
	if err != nil {
		return nil, 0, err
	}
	generated := 0
	// Suggestions are still pending candidates. A high model confidence only
	// controls whether we enqueue them; it never publishes an active alias.
	if decision == "approve" && confidence >= 0.95 {
		for _, aliasName := range suggestedAliases {
			model := s.model
			modelDecision := "suggested"
			modelReason := "由 AI 预审建议生成，仍需独立人工审核"
			generatedFromID := candidate.ID
			_, createErr := s.repo.Create(ctx, repo.CreateNutritionAliasCandidateInput{
				AliasName: aliasName, ProposedFoodID: candidate.ProposedFoodID, Source: "ai_generated",
				Model: &model, ModelDecision: &modelDecision, ModelConfidence: &confidence,
				ModelReason: &modelReason, GeneratedFromID: &generatedFromID,
			})
			if createErr == nil {
				generated++
			}
		}
	}
	return updated, generated, nil
}

func (s *NutritionAliasReviewService) BatchAIReview(ctx context.Context, input BatchAIReviewInput) (*BatchAIReviewResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}
	items, err := s.repo.List(ctx, repo.ListNutritionAliasCandidatesInput{Status: repo.AliasCandidatePending, Limit: limit})
	if err != nil {
		return nil, err
	}
	result := &BatchAIReviewResult{Requested: len(items.Items), Errors: []string{}}
	// Deliberately use isolated single-item calls. The current relay has shown
	// unstable long/batch responses, while one-item JSON calls are auditable.
	for _, item := range items.Items {
		if _, _, reviewErr := s.AIReview(ctx, item.ID); reviewErr != nil {
			result.Failed++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", item.AliasName, reviewErr))
			continue
		}
		result.Succeeded++
	}
	return result, nil
}

func (s *NutritionAliasReviewService) Review(ctx context.Context, id, reviewerID string, input ReviewNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error) {
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	if decision != repo.AliasCandidateApproved && decision != repo.AliasCandidateRejected {
		return nil, badAliasRequest("审核结论必须为 approved 或 rejected")
	}
	item, err := s.repo.Review(ctx, strings.TrimSpace(id), decision, strings.TrimSpace(reviewerID), strings.TrimSpace(input.Note))
	if err != nil {
		return nil, badAliasRequest(err.Error())
	}
	return item, nil
}

func buildAliasReviewPrompt(item *repo.NutritionAliasCandidate) string {
	payload := map[string]any{
		"task": "审核一个食物别名是否可以安全、唯一地指向目标营养条目",
		"alias": item.AliasName,
		"target": map[string]any{
			"canonicalName": item.ProposedCanonicalName,
			"kcalPer100g": item.KcalPer100g, "proteinPer100g": item.ProteinPer100g,
			"carbsPer100g": item.CarbsPer100g, "fatPer100g": item.FatPer100g,
		},
		"rules": []string{
			"别名必须与目标是同一种完整食物、同一形态和同一营养口径；相关、包含某配料或经常一起出现都不算别名。",
			"牛肉面不是瘦牛肉，鸡蛋面不是鸡蛋，牛肉饭不是牛肉；混合餐不能指向单一原料。",
			"粉剂与冲调后的液体不是同一营养口径；生熟、干湿、含糖无糖若营养差异明显，应拒绝或人工复核。",
			"名称含面、饭、粥、饺、包子等主食时，目标碳水接近 0 必须拒绝。",
			"不要根据模糊语义、常识联想或字符串包含关系批准。无法确信时返回 manual_review。",
			"suggestedAliases 最多 5 个，只能给目标食物本身严格等价的常用名称；不要生成菜品组合、上位词、下位词或成分词。",
		},
		"responseSchema": map[string]any{
			"decision": "approve|reject|manual_review", "confidence": 0.0,
			"reason": "简洁、可复核的中文理由", "riskFlags": []string{}, "suggestedAliases": []string{},
		},
	}
	data, _ := json.Marshal(payload)
	return "你是食品营养数据库的严格审核员。宁可进入人工复核，也不要误建别名。只返回 JSON。\n" + string(data)
}

func normalizeAIDecision(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "approve", "reject", "manual_review":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "manual_review"
	}
}

func clampConfidence(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprintf("%v", value)
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case json.Number:
		result, _ := typed.Float64()
		return result
	default:
		return 0
	}
}

func normalizeStringList(value any, limit int) []string {
	values, ok := value.([]any)
	if !ok {
		if stringsList, ok := value.([]string); ok {
			values = make([]any, len(stringsList))
			for i := range stringsList {
				values[i] = stringsList[i]
			}
		} else {
			return []string{}
		}
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, min(limit, len(values)))
	for _, raw := range values {
		text := strings.TrimSpace(stringValue(raw))
		if text == "" || utf8.RuneCountInString(text) > 80 {
			continue
		}
		key := strings.ToLower(text)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, text)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func normalizeSuggestedAliases(value any, item *repo.NutritionAliasCandidate) []string {
	values := normalizeStringList(value, 5)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.EqualFold(value, item.AliasName) || strings.EqualFold(value, item.ProposedCanonicalName) {
			continue
		}
		result = append(result, value)
	}
	return result
}

func badAliasRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

