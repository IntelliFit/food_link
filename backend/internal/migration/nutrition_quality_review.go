package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"time"
	"unicode"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type NutritionReviewValues struct {
	Kcal    float64 `json:"kcal"`
	Protein float64 `json:"protein"`
	Carbs   float64 `json:"carbs"`
	Fat     float64 `json:"fat"`
	Fiber   float64 `json:"fiber"`
	Sugar   float64 `json:"sugar"`
}

type NutritionQualityReviewRow struct {
	ID                string                `json:"id"`
	CanonicalName     string                `json:"canonical_name"`
	Source            string                `json:"source"`
	ExpectedNutrition NutritionReviewValues `json:"expected_nutrition"`
	ExpectedHash      string                `json:"expected_hash"`
	Action            string                `json:"action"`
	TargetFoodID      string                `json:"target_food_id"`
	TargetName        string                `json:"target_name"`
	Nutrition         NutritionReviewValues `json:"nutrition"`
	Evidence          map[string]any        `json:"evidence"`
}

type NutritionQualityReviewArtifact struct {
	BatchID       string                      `json:"batch_id"`
	PolicyVersion string                      `json:"policy_version"`
	GeneratedAt   string                      `json:"generated_at"`
	Rows          []NutritionQualityReviewRow `json:"rows"`
	Aliases       []NutritionAliasReviewRow   `json:"aliases"`
}

type NutritionAliasReviewRow struct {
	ID              string         `json:"id"`
	FoodID          string         `json:"food_id"`
	AliasName       string         `json:"alias_name"`
	NormalizedAlias string         `json:"normalized_alias"`
	CanonicalName   string         `json:"canonical_name"`
	Source          string         `json:"source"`
	MatchStatus     string         `json:"match_status"`
	Reason          string         `json:"reason"`
	Reviews         map[string]any `json:"reviews"`
}

type NutritionQualityReviewResult struct {
	BatchID    string         `json:"batch_id"`
	DryRun     bool           `json:"dry_run"`
	Total      int            `json:"total"`
	AliasTotal int            `json:"alias_total"`
	Actions    map[string]int `json:"actions"`
	Aliases    map[string]int `json:"aliases"`
}

var nutritionReviewActions = map[string]bool{
	"merge_authority":            true,
	"promote_consensus_estimate": true,
	"hold_ambiguous":             true,
	"reject_invalid":             true,
}

var nutritionAliasReviewStatuses = map[string]bool{
	foodrecorddomain.NutritionAliasApprovedExact: true,
	foodrecorddomain.NutritionAliasCandidateOnly: true,
	foodrecorddomain.NutritionAliasBlocked:       true,
}

// ApplyNutritionQualityReview validates every row against its pre-review
// snapshot before making any change. The entire batch is atomic: an alias
// conflict, changed source row, or invalid target aborts all writes.
func ApplyNutritionQualityReview(ctx context.Context, db *gorm.DB, schema, artifactPath string, apply bool) (*NutritionQualityReviewResult, error) {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(artifactPath)
	if err != nil {
		return nil, fmt.Errorf("读取营养审核产物: %w", err)
	}
	var artifact NutritionQualityReviewArtifact
	if err := json.Unmarshal(body, &artifact); err != nil {
		return nil, fmt.Errorf("解析营养审核产物: %w", err)
	}
	if strings.TrimSpace(artifact.BatchID) == "" || strings.TrimSpace(artifact.PolicyVersion) == "" || len(artifact.Rows) == 0 || len(artifact.Aliases) == 0 {
		return nil, fmt.Errorf("营养审核产物缺少批次、策略版本、营养行或别名行")
	}
	result := &NutritionQualityReviewResult{
		BatchID:    artifact.BatchID,
		DryRun:     !apply,
		Total:      len(artifact.Rows),
		AliasTotal: len(artifact.Aliases),
		Actions:    map[string]int{},
		Aliases:    map[string]int{},
	}
	seen := make(map[string]struct{}, len(artifact.Rows))
	for _, row := range artifact.Rows {
		row.ID = strings.TrimSpace(row.ID)
		if row.ID == "" || !nutritionReviewActions[row.Action] {
			return nil, fmt.Errorf("营养审核产物含无效行: id=%q action=%q", row.ID, row.Action)
		}
		if _, ok := seen[row.ID]; ok {
			return nil, fmt.Errorf("营养审核产物含重复 ID: %s", row.ID)
		}
		seen[row.ID] = struct{}{}
		result.Actions[row.Action]++
	}
	seenAliases := make(map[string]struct{}, len(artifact.Aliases))
	for _, row := range artifact.Aliases {
		row.ID = strings.TrimSpace(row.ID)
		if row.ID == "" || !nutritionAliasReviewStatuses[row.MatchStatus] {
			return nil, fmt.Errorf("营养审核产物含无效别名: id=%q status=%q", row.ID, row.MatchStatus)
		}
		if _, ok := seenAliases[row.ID]; ok {
			return nil, fmt.Errorf("营养审核产物含重复别名 ID: %s", row.ID)
		}
		seenAliases[row.ID] = struct{}{}
		result.Aliases[row.MatchStatus]++
	}

	return result, db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range artifact.Aliases {
			if err := applyNutritionAliasReviewRow(tx, artifact, row, apply); err != nil {
				return fmt.Errorf("应用营养别名审核行 %s(%s): %w", row.ID, row.AliasName, err)
			}
		}
		for _, row := range artifact.Rows {
			if err := applyNutritionQualityReviewRow(tx, artifact, row, apply); err != nil {
				return fmt.Errorf("应用营养审核行 %s(%s): %w", row.ID, row.CanonicalName, err)
			}
		}
		return nil
	})
}

func applyNutritionAliasReviewRow(tx *gorm.DB, artifact NutritionQualityReviewArtifact, row NutritionAliasReviewRow, apply bool) error {
	var current foodrecorddomain.FoodNutritionAlias
	query := tx.Where("id = ?", row.ID)
	if apply {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&current).Error; err != nil {
		return err
	}
	if current.FoodID != row.FoodID || strings.TrimSpace(current.AliasName) != strings.TrimSpace(row.AliasName) || current.NormalizedAlias != row.NormalizedAlias {
		return fmt.Errorf("别名或目标在审核后发生变化")
	}
	var target foodrecorddomain.FoodNutrition
	if err := tx.Where("id = ?", row.FoodID).First(&target).Error; err != nil {
		return fmt.Errorf("别名目标不存在: %w", err)
	}
	if !target.IsActive || strings.TrimSpace(target.CanonicalName) != strings.TrimSpace(row.CanonicalName) || strings.TrimSpace(target.Source) != strings.TrimSpace(row.Source) {
		return fmt.Errorf("别名目标在审核后发生变化或已停用")
	}
	if row.MatchStatus == foodrecorddomain.NutritionAliasApprovedExact && !foodrecorddomain.IsNutritionExactMatchEligible(target) {
		return fmt.Errorf("别名目标未达到精确复用可信等级")
	}
	if reviewEvidenceBatchID(current.ApprovalEvidence) == artifact.BatchID {
		if current.MatchStatus != row.MatchStatus {
			return fmt.Errorf("同一审核批次已写入，但别名最终状态不一致: current=%s expected=%s", current.MatchStatus, row.MatchStatus)
		}
		return nil
	}
	if !apply {
		return nil
	}
	now := time.Now()
	evidence := datatypes.JSONMap{
		"approval_source": "nutrition_alias_dual_review",
		"batch_id":        artifact.BatchID,
		"policy_version":  artifact.PolicyVersion,
		"reason":          row.Reason,
		"reviews":         row.Reviews,
	}
	return tx.Model(&foodrecorddomain.FoodNutritionAlias{}).Where("id = ?", row.ID).Updates(map[string]any{
		"match_status":      row.MatchStatus,
		"approval_evidence": evidence,
		"reviewed_at":       now,
	}).Error
}

func applyNutritionQualityReviewRow(tx *gorm.DB, artifact NutritionQualityReviewArtifact, row NutritionQualityReviewRow, apply bool) error {
	var current foodrecorddomain.FoodNutrition
	query := tx.Where("id = ?", row.ID)
	if apply {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&current).Error; err != nil {
		return err
	}
	if !foodrecorddomain.IsAIGeneratedNutritionSource(current.Source) {
		return fmt.Errorf("来源已不再是 AI 生成: %s", current.Source)
	}
	if strings.TrimSpace(current.CanonicalName) != strings.TrimSpace(row.CanonicalName) || strings.TrimSpace(current.Source) != strings.TrimSpace(row.Source) {
		return fmt.Errorf("名称或来源在审核后发生变化")
	}
	if reviewEvidenceBatchID(current.QualityEvidence) == artifact.BatchID {
		if err := validateNutritionReviewFinalState(current, row); err != nil {
			return err
		}
		if row.Action == "merge_authority" {
			return validateNutritionAuthorityMerge(tx, row, current.QualityEvidence, false)
		}
		return nil
	}
	if !nutritionReviewValuesEqual(nutritionReviewValuesFromFood(current), row.ExpectedNutrition) {
		return fmt.Errorf("营养值在审核后发生变化")
	}

	now := time.Now()
	evidence := datatypes.JSONMap{
		"batch_id":        artifact.BatchID,
		"policy_version":  artifact.PolicyVersion,
		"action":          row.Action,
		"expected_hash":   row.ExpectedHash,
		"review_evidence": row.Evidence,
		"applied_at":      now.UTC().Format(time.RFC3339Nano),
	}
	if !apply {
		if row.Action == "merge_authority" {
			return validateNutritionAuthorityMerge(tx, row, evidence, false)
		}
		if row.Action == "promote_consensus_estimate" {
			return validateConsensusNutrition(row.Nutrition)
		}
		return nil
	}

	switch row.Action {
	case "merge_authority":
		if err := validateNutritionAuthorityMerge(tx, row, evidence, true); err != nil {
			return err
		}
		return tx.Model(&foodrecorddomain.FoodNutrition{}).Where("id = ?", row.ID).Updates(map[string]any{
			"is_active":           false,
			"quality_tier":        foodrecorddomain.NutritionQualityPlausible,
			"quality_evidence":    evidence,
			"quality_reviewed_at": now,
		}).Error
	case "promote_consensus_estimate":
		if err := validateConsensusNutrition(row.Nutrition); err != nil {
			return err
		}
		updates := reviewedEstimateUpdates(row.Nutrition, evidence, now)
		return tx.Model(&foodrecorddomain.FoodNutrition{}).Where("id = ?", row.ID).Updates(updates).Error
	case "hold_ambiguous":
		return tx.Model(&foodrecorddomain.FoodNutrition{}).Where("id = ?", row.ID).Updates(map[string]any{
			"is_active":           false,
			"quality_tier":        foodrecorddomain.NutritionQualityPlausible,
			"quality_evidence":    evidence,
			"quality_reviewed_at": now,
		}).Error
	case "reject_invalid":
		return tx.Model(&foodrecorddomain.FoodNutrition{}).Where("id = ?", row.ID).Updates(map[string]any{
			"is_active":           false,
			"quality_tier":        foodrecorddomain.NutritionQualityRejected,
			"quality_evidence":    evidence,
			"quality_reviewed_at": now,
		}).Error
	default:
		return fmt.Errorf("不支持的审核动作: %s", row.Action)
	}
}

func reviewEvidenceBatchID(evidence datatypes.JSONMap) string {
	if evidence == nil {
		return ""
	}
	value, _ := evidence["batch_id"].(string)
	return strings.TrimSpace(value)
}

func validateNutritionReviewFinalState(current foodrecorddomain.FoodNutrition, row NutritionQualityReviewRow) error {
	valid := false
	switch row.Action {
	case "merge_authority", "hold_ambiguous":
		valid = !current.IsActive && current.QualityTier == foodrecorddomain.NutritionQualityPlausible
	case "reject_invalid":
		valid = !current.IsActive && current.QualityTier == foodrecorddomain.NutritionQualityRejected
	case "promote_consensus_estimate":
		valid = current.IsActive &&
			current.QualityTier == foodrecorddomain.NutritionQualityReviewedEstimate &&
			nutritionReviewValuesEqual(nutritionReviewValuesFromFood(current), row.Nutrition)
	}
	if !valid {
		return fmt.Errorf("同一审核批次已写入，但营养行最终状态不一致: action=%s active=%t tier=%s", row.Action, current.IsActive, current.QualityTier)
	}
	return nil
}

func validateNutritionAuthorityMerge(tx *gorm.DB, row NutritionQualityReviewRow, evidence datatypes.JSONMap, apply bool) error {
	var target foodrecorddomain.FoodNutrition
	if err := tx.Where("id = ?", strings.TrimSpace(row.TargetFoodID)).First(&target).Error; err != nil {
		return fmt.Errorf("权威目标不存在: %w", err)
	}
	if !target.IsActive || foodrecorddomain.EffectiveNutritionQualityTier(target) != foodrecorddomain.NutritionQualityAuthoritative {
		return fmt.Errorf("目标未达到 active authoritative: %s", target.ID)
	}
	normalized := normalizeNutritionReviewName(row.CanonicalName)
	if normalized == "" {
		return fmt.Errorf("无法规范化待合并名称")
	}
	var existing foodrecorddomain.FoodNutritionAlias
	err := tx.Where("normalized_alias = ?", normalized).First(&existing).Error
	if err == nil && existing.FoodID != target.ID {
		return fmt.Errorf("正式别名已指向其他食物 %s", existing.FoodID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	if !apply {
		return nil
	}
	aliasEvidence := datatypes.JSONMap{
		"approval_source": "nutrition_quality_review",
		"batch_id":        evidence["batch_id"],
		"policy_version":  evidence["policy_version"],
		"source_food_id":  row.ID,
		"review_evidence": evidence["review_evidence"],
	}
	now := time.Now()
	if err == nil {
		return tx.Model(&foodrecorddomain.FoodNutritionAlias{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"match_status":      foodrecorddomain.NutritionAliasApprovedExact,
			"approval_evidence": aliasEvidence,
			"reviewed_at":       now,
		}).Error
	}
	return tx.Create(&foodrecorddomain.FoodNutritionAlias{
		ID:               uuid.NewString(),
		FoodID:           target.ID,
		AliasName:        strings.TrimSpace(row.CanonicalName),
		NormalizedAlias:  normalized,
		MatchStatus:      foodrecorddomain.NutritionAliasApprovedExact,
		ApprovalEvidence: aliasEvidence,
		ReviewedAt:       &now,
	}).Error
}

func validateConsensusNutrition(value NutritionReviewValues) error {
	values := []float64{value.Kcal, value.Protein, value.Carbs, value.Fat, value.Fiber, value.Sugar}
	for _, current := range values {
		if math.IsNaN(current) || math.IsInf(current, 0) || current < 0 {
			return fmt.Errorf("晋升营养含无效数值")
		}
	}
	if value.Kcal <= 0 || value.Kcal > 900 || value.Protein+value.Carbs+value.Fat > 100.001 || value.Sugar > value.Carbs+0.001 {
		return fmt.Errorf("晋升营养违反每100克物理约束")
	}
	macroEnergy := value.Protein*4 + value.Carbs*4 + value.Fat*9
	if math.Abs(value.Kcal-macroEnergy) > 0.15 {
		return fmt.Errorf("晋升营养不满足4/4/9能量一致性")
	}
	return nil
}

func reviewedEstimateUpdates(value NutritionReviewValues, evidence datatypes.JSONMap, now time.Time) map[string]any {
	updates := map[string]any{
		"kcal_per_100g":       value.Kcal,
		"protein_per_100g":    value.Protein,
		"carbs_per_100g":      value.Carbs,
		"fat_per_100g":        value.Fat,
		"fiber_per_100g":      value.Fiber,
		"sugar_per_100g":      value.Sugar,
		"is_active":           true,
		"quality_tier":        foodrecorddomain.NutritionQualityReviewedEstimate,
		"quality_evidence":    evidence,
		"quality_reviewed_at": now,
	}
	for _, column := range []string{
		"saturated_fat_per_100g", "cholesterol_mg_per_100g", "sodium_mg_per_100g",
		"potassium_mg_per_100g", "calcium_mg_per_100g", "iron_mg_per_100g",
		"magnesium_mg_per_100g", "zinc_mg_per_100g", "vitamin_a_rae_mcg_per_100g",
		"vitamin_c_mg_per_100g", "vitamin_d_mcg_per_100g", "vitamin_e_mg_per_100g",
		"vitamin_k_mcg_per_100g", "thiamin_mg_per_100g", "riboflavin_mg_per_100g",
		"niacin_mg_per_100g", "vitamin_b6_mg_per_100g", "folate_mcg_per_100g",
		"vitamin_b12_mcg_per_100g",
	} {
		updates[column] = 0
	}
	return updates
}

func nutritionReviewValuesFromFood(food foodrecorddomain.FoodNutrition) NutritionReviewValues {
	return NutritionReviewValues{
		Kcal: food.KcalPer100g, Protein: food.ProteinPer100g, Carbs: food.CarbsPer100g,
		Fat: food.FatPer100g, Fiber: food.FiberPer100g, Sugar: food.SugarPer100g,
	}
}

func nutritionReviewValuesEqual(left, right NutritionReviewValues) bool {
	return math.Abs(left.Kcal-right.Kcal) <= 0.0001 &&
		math.Abs(left.Protein-right.Protein) <= 0.0001 &&
		math.Abs(left.Carbs-right.Carbs) <= 0.0001 &&
		math.Abs(left.Fat-right.Fat) <= 0.0001 &&
		math.Abs(left.Fiber-right.Fiber) <= 0.0001 &&
		math.Abs(left.Sugar-right.Sugar) <= 0.0001
}

func normalizeNutritionReviewName(raw string) string {
	var builder strings.Builder
	for _, current := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(current) || unicode.IsDigit(current) {
			builder.WriteRune(current)
		}
	}
	return builder.String()
}
