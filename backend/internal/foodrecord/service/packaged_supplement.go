package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/foodrecord/domain"
)

// 用户在包装食品任务详情里点「补充信息」后提交的表单，会带上原识别任务 ID。
// 这里把用户补的字段合并回原识别结果，重新跑一遍自动入库门槛：
//   - 只补了识别缺失的字段（如散装称重后的净含量），名称和营养数值没改 → 直接入库并按正常上传发奖励；
//   - 改了识别出的名称/品牌/营养数值，或补完仍不达标 → 仍进待审核。
// 两种结果都会写回原任务，任务详情页不再停在「未入库，可补充」。

const (
	PackagedSupplementStatusIngested      = "ingested"
	PackagedSupplementStatusPendingReview = "pending_review"

	packagedSupplementMinNetWeightG = 1
	packagedSupplementMaxNetWeightG = 5000
)

// PackagedSupplementOutcome 写回任务 result.supplement_result，同时随接口返回。
type PackagedSupplementOutcome struct {
	Status         string         `json:"status"`
	Reason         string         `json:"reason,omitempty"`
	PackagedFoodID string         `json:"packaged_food_id,omitempty"`
	UpsertAction   string         `json:"upsert_action,omitempty"`
	FilledFields   []string       `json:"filled_fields,omitempty"`
	EditedFields   []string       `json:"edited_fields,omitempty"`
	RewardResult   map[string]any `json:"reward_result,omitempty"`
	SubmittedAt    string         `json:"submitted_at,omitempty"`
	// TaskUpdateErr 记录写回任务失败的原因；商品已经保存，不让用户重复提交。
	TaskUpdateErr error `json:"-"`
}

type packagedSupplementPlan struct {
	Merged       *PackagedProductExtractResult
	FilledFields []string
	EditedFields []string
	// BlockReason 为空表示可以直接入库。
	BlockReason string
}

// SupplementPackagedExtractTask 处理带 source_task_id 的补充提交。
// 任务不可用（不存在旧数据结构、已入库）时回退到原来的待审核保存，不写任务。
func (s *FoodNutritionService) SupplementPackagedExtractTask(
	ctx context.Context,
	userID string,
	taskID string,
	input PackagedFoodInput,
) (*domain.PackagedFood, *PackagedSupplementOutcome, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || s.taskRepo == nil {
		return s.createPendingPackagedSupplement(ctx, input)
	}
	task, err := s.taskRepo.GetTaskByID(ctx, taskID)
	if err != nil {
		return nil, nil, err
	}
	// 识别结果页的「贡献零食」也会带饮食分析任务 ID；不是本人已完成的包装识别任务就按原来的待审核保存。
	if !isSupplementablePackagedTask(task, userID) {
		return s.createPendingPackagedSupplement(ctx, input)
	}
	extracted, ok := packagedExtractFromTaskResult(task.Result)
	if !ok || extracted.AutoIngestResult.Status == "ingested" {
		return s.createPendingPackagedSupplement(ctx, input)
	}

	plan := planPackagedSupplement(extracted, input)
	var (
		item    *domain.PackagedFood
		outcome *PackagedSupplementOutcome
	)
	if plan.BlockReason == "" {
		item, outcome, err = s.ingestPackagedSupplement(ctx, userID, taskID, plan)
	} else {
		item, outcome, err = s.createPendingPackagedSupplement(ctx, input)
		if outcome != nil {
			outcome.Reason = plan.BlockReason
		}
	}
	if err != nil {
		return nil, nil, err
	}
	outcome.FilledFields = plan.FilledFields
	outcome.EditedFields = plan.EditedFields
	outcome.SubmittedAt = time.Now().Format(time.RFC3339)

	nextResult := applyPackagedSupplementToTaskResult(task.Result, plan.Merged, outcome)
	if updateErr := s.taskRepo.UpdateTaskResult(ctx, taskID, nextResult); updateErr != nil {
		outcome.TaskUpdateErr = updateErr
	}
	return item, outcome, nil
}

func isSupplementablePackagedTask(task *analyzedomain.AnalysisTask, userID string) bool {
	if task == nil || strings.TrimSpace(userID) == "" {
		return false
	}
	return strings.TrimSpace(task.UserID) == strings.TrimSpace(userID) &&
		task.TaskType == packagedProductExtractTaskType &&
		task.Status == "done"
}

func (s *FoodNutritionService) createPendingPackagedSupplement(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, *PackagedSupplementOutcome, error) {
	pending := input
	pending.ReviewStatus = "pending"
	item, action, err := s.CreatePackagedFoodWithAction(ctx, pending)
	if err != nil {
		return nil, nil, err
	}
	return item, &PackagedSupplementOutcome{
		Status:         PackagedSupplementStatusPendingReview,
		PackagedFoodID: item.ID,
		UpsertAction:   action,
	}, nil
}

func (s *FoodNutritionService) ingestPackagedSupplement(ctx context.Context, userID, taskID string, plan packagedSupplementPlan) (*domain.PackagedFood, *PackagedSupplementOutcome, error) {
	ingestInput := buildPackagedFoodInputFromExtract(plan.Merged, PackagedImportIngestOptions{
		Source:       "user_capture_ocr",
		IngestMethod: packagedFoodIngestMethodUserCaptureOCR,
	})
	ingestInput.RawLabelPayload = withSupplementMarker(plan.Merged.RawLabelPayload, taskID, plan.FilledFields)
	item, action, err := s.CreatePackagedFoodWithAction(ctx, ingestInput)
	if err != nil {
		return nil, nil, err
	}
	return item, &PackagedSupplementOutcome{
		Status:         PackagedSupplementStatusIngested,
		Reason:         "passed",
		PackagedFoodID: item.ID,
		UpsertAction:   action,
		RewardResult:   s.rewardPackagedSupplement(ctx, userID, taskID, action, item),
	}, nil
}

// rewardPackagedSupplement 与识别 worker 自动入库同一套规则：新建且达到质量门槛才发奖励。
func (s *FoodNutritionService) rewardPackagedSupplement(ctx context.Context, userID, taskID, action string, item *domain.PackagedFood) map[string]any {
	if action != "created" {
		return map[string]any{
			"awarded":          false,
			"already_exists":   true,
			"reason":           "packaged_food_existing",
			"packaged_food_id": item.ID,
		}
	}
	if !PackagedFoodQualifiesForReward(item) {
		return map[string]any{"awarded": false, "reason": "quality_not_rewardable", "packaged_food_id": item.ID}
	}
	awarded, err := s.AwardPackagedUpload(ctx, userID, taskID, item.ID, map[string]any{
		"packaged_food_id": item.ID,
		"source_task_id":   taskID,
		"product_name":     item.ProductName,
		"upsert_action":    action,
		"entry_source":     "supplement_after_ocr",
	})
	if err != nil {
		return map[string]any{"awarded": false, "reason": "award_failed", "packaged_food_id": item.ID}
	}
	if awarded == nil {
		return map[string]any{"awarded": false, "packaged_food_id": item.ID}
	}
	return awarded
}

func packagedExtractFromTaskResult(result map[string]any) (*PackagedProductExtractResult, bool) {
	raw, ok := result["packaged_product"].(map[string]any)
	if !ok || len(raw) == 0 {
		return nil, false
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	var extracted PackagedProductExtractResult
	if err := json.Unmarshal(data, &extracted); err != nil {
		return nil, false
	}
	return &extracted, true
}

// planPackagedSupplement 是纯函数：合并字段并判断能否直接入库，不改动 extracted。
func planPackagedSupplement(extracted *PackagedProductExtractResult, input PackagedFoodInput) packagedSupplementPlan {
	merged := clonePackagedExtract(extracted)
	filled := []string{}
	edited := []string{}

	mergeText := func(field string, current *string, supplied string) {
		supplied = strings.TrimSpace(supplied)
		if supplied == "" {
			return
		}
		if strings.TrimSpace(*current) == "" {
			*current = supplied
			filled = append(filled, field)
			return
		}
		if normalizeSupplementText(*current) != normalizeSupplementText(supplied) {
			edited = append(edited, field)
		}
	}
	mergeText("product_name", &merged.ProductName, input.ProductName)
	mergeText("brand", &merged.Brand, input.Brand)

	fillOnly := func(field string, current *string, supplied string) {
		supplied = strings.TrimSpace(supplied)
		if supplied != "" && strings.TrimSpace(*current) == "" {
			*current = supplied
			filled = append(filled, field)
		}
	}
	fillOnly("barcode", &merged.Barcode, input.Barcode)
	fillOnly("flavor_text", &merged.FlavorText, input.FlavorText)
	fillOnly("ingredients_text", &merged.IngredientsText, input.IngredientsText)

	hadNetContent := merged.NetWeightG > 0 || merged.NetContentValue > 0
	suppliedNet := input.NetWeightG
	switch {
	case !hadNetContent && suppliedNet > 0:
		merged.NetWeightG = suppliedNet
		merged.NetContentValue = suppliedNet
		merged.NetContentUnit = "g"
		if strings.TrimSpace(merged.SpecText) == "" {
			merged.SpecText = formatSupplementGrams(suppliedNet)
		}
		filled = append(filled, "net_weight_g")
	case hadNetContent && suppliedNet > 0 && merged.NetWeightG > 0 && math.Abs(suppliedNet-merged.NetWeightG) > 1:
		edited = append(edited, "net_weight_g")
	}
	if merged.ServingWeightG <= 0 && input.ServingWeightG > 0 {
		merged.ServingWeightG = input.ServingWeightG
	}

	edited = append(edited, editedSupplementNutrition(merged.UnitNutritionPer100g, input)...)
	merged.MissingFields = withoutFilledMissingFields(merged.MissingFields, filled)
	merged.ConfirmationReasons, merged.ConfirmationFields = determinePackagedConfirmation(merged)
	merged.NeedsUserConfirmation = len(merged.ConfirmationReasons) > 0

	plan := packagedSupplementPlan{Merged: merged, FilledFields: filled, EditedFields: edited}
	plan.BlockReason = packagedSupplementBlockReason(merged, filled, edited)
	return plan
}

func packagedSupplementBlockReason(merged *PackagedProductExtractResult, filled, edited []string) string {
	if len(edited) > 0 {
		return "edited_recognized_fields"
	}
	if len(filled) == 0 {
		return "nothing_supplemented"
	}
	if merged.NetWeightG > 0 && (merged.NetWeightG < packagedSupplementMinNetWeightG || merged.NetWeightG > packagedSupplementMaxNetWeightG) {
		return "net_weight_out_of_range"
	}
	auto := evaluatePackagedAutoIngest(merged)
	if auto.Status != "ready" {
		return auto.Reason
	}
	if len(auto.ConflictReasons) > 0 {
		return "conflict"
	}
	return ""
}

// editedSupplementNutrition 识别结果已有的核心营养素被改动（或识别没有、用户自己填了）都算改动，需要人工核对。
func editedSupplementNutrition(recognized map[string]any, input PackagedFoodInput) []string {
	pairs := []struct {
		field    string
		key      string
		supplied float64
	}{
		{"kcal_per_100g", "calories", input.KcalPer100g},
		{"protein_per_100g", "protein", input.ProteinPer100g},
		{"carbs_per_100g", "carbs", input.CarbsPer100g},
		{"fat_per_100g", "fat", input.FatPer100g},
	}
	edited := []string{}
	for _, pair := range pairs {
		recognizedValue := numberFromAny(recognized[pair.key])
		tolerance := math.Max(0.6, recognizedValue*0.02)
		if math.Abs(pair.supplied-recognizedValue) > tolerance {
			edited = append(edited, pair.field)
		}
	}
	return edited
}

func withoutFilledMissingFields(missing, filled []string) []string {
	cleared := map[string]bool{}
	for _, field := range filled {
		switch field {
		case "net_weight_g":
			for _, alias := range []string{"net_weight_g", "net_content", "net_content_value", "net_content_unit", "spec_text"} {
				cleared[alias] = true
			}
		default:
			cleared[field] = true
		}
	}
	out := make([]string, 0, len(missing))
	for _, field := range missing {
		if !cleared[strings.TrimSpace(field)] {
			out = append(out, field)
		}
	}
	return out
}

// applyPackagedSupplementToTaskResult 返回新的任务 result，不修改传入的 map。
func applyPackagedSupplementToTaskResult(result map[string]any, merged *PackagedProductExtractResult, outcome *PackagedSupplementOutcome) map[string]any {
	next := make(map[string]any, len(result)+1)
	for key, value := range result {
		next[key] = value
	}
	outcomeMap := packagedSupplementOutcomeMap(outcome)
	next["supplement_result"] = outcomeMap
	if outcome.Status != PackagedSupplementStatusIngested || merged == nil {
		return next
	}

	updated := clonePackagedExtract(merged)
	updated.AutoIngestResult = PackagedAutoIngestResult{
		Status:         "ingested",
		Reason:         "supplement_passed",
		UpsertAction:   outcome.UpsertAction,
		PackagedFoodID: outcome.PackagedFoodID,
	}
	updated.PackagedFoodID = outcome.PackagedFoodID
	if packagedMap, ok := structToMap(updated); ok {
		next["packaged_product"] = packagedMap
		if _, hasNutrition := result["nutrition"]; hasNutrition {
			next["nutrition"] = packagedMap
		}
	}
	if outcome.RewardResult != nil {
		next["reward_result"] = outcome.RewardResult
	}
	return next
}

func packagedSupplementOutcomeMap(outcome *PackagedSupplementOutcome) map[string]any {
	out, ok := structToMap(outcome)
	if !ok {
		return map[string]any{"status": outcome.Status}
	}
	return out
}

func structToMap(value any) (map[string]any, bool) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, false
	}
	return out, true
}

func clonePackagedExtract(source *PackagedProductExtractResult) *PackagedProductExtractResult {
	if source == nil {
		return &PackagedProductExtractResult{}
	}
	data, err := json.Marshal(source)
	if err != nil {
		copied := *source
		return &copied
	}
	var copied PackagedProductExtractResult
	if err := json.Unmarshal(data, &copied); err != nil {
		fallback := *source
		return &fallback
	}
	return &copied
}

func withSupplementMarker(payload map[string]any, taskID string, filled []string) map[string]any {
	next := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		next[key] = value
	}
	next["supplement"] = map[string]any{
		"entry_source":   "supplement_after_ocr",
		"source_task_id": taskID,
		"filled_fields":  filled,
	}
	return next
}

func normalizeSupplementText(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), ""))
}

func formatSupplementGrams(value float64) string {
	return strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.1f", value), "0"), ".") + "g"
}

// PackagedFoodQualifiesForReward 是包装食品上传发奖励的质量门槛，识别 worker 和补充提交共用。
func PackagedFoodQualifiesForReward(food *domain.PackagedFood) bool {
	if food == nil || !food.IsActive {
		return false
	}
	if strings.TrimSpace(food.ProductName) == "" || len(food.SourceImageURLs) == 0 {
		return false
	}
	netUnit := derefSupplementString(food.NetContentUnit)
	if food.NetContentValue <= 0 || strings.TrimSpace(netUnit) == "" {
		return false
	}
	if strings.EqualFold(netUnit, "g") && food.NetWeightG <= 0 {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(derefSupplementString(food.ConversionStatus)), "converted") {
		return false
	}
	verifiedZeroNutrition := PackagedFoodHasVerifiedZeroNutritionEvidence(food)
	if (food.KcalPer100g <= 0 && !verifiedZeroNutrition) || food.KcalPer100g > 900 {
		return false
	}
	macroSum := food.ProteinPer100g + food.CarbsPer100g + food.FatPer100g
	if (macroSum <= 0 && !verifiedZeroNutrition) || macroSum > 120 {
		return false
	}
	for _, value := range []float64{food.ProteinPer100g, food.CarbsPer100g, food.FatPer100g} {
		if value < 0 || value > 100 {
			return false
		}
	}
	return true
}

func derefSupplementString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
