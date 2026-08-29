package main

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	fooddomain "food_link/backend/internal/foodrecord/domain"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const auditPolicyVersion = "boohee_assisted_review_v1"

type auditReport struct {
	PolicyVersion   string         `json:"policy_version"`
	AuditedAt       time.Time      `json:"audited_at"`
	Total           int            `json:"total"`
	Approved        int            `json:"approved"`
	NeedsUserReview int            `json:"needs_user_review"`
	Verified        int            `json:"verified"`
	ReasonCounts    map[string]int `json:"reason_counts"`
	Entries         []auditEntry   `json:"entries"`
}

type auditEntry struct {
	Sequence       int      `json:"sequence"`
	FoodID         string   `json:"food_id"`
	CanonicalName  string   `json:"canonical_name"`
	SearchTerm     string   `json:"search_term"`
	Decision       string   `json:"decision"`
	ReasonCodes    []string `json:"reason_codes"`
	ReasonLabels   []string `json:"reason_labels"`
	Kcal           float64  `json:"kcal_per_100g"`
	Protein        float64  `json:"protein_per_100g"`
	Carbs          float64  `json:"carbs_per_100g"`
	Fat            float64  `json:"fat_per_100g"`
	MacroKcal      float64  `json:"macro_kcal"`
	MissingFields  []string `json:"missing_fields,omitempty"`
	ConflictFoodID string   `json:"conflict_food_id,omitempty"`
	ConflictName   string   `json:"conflict_name,omitempty"`
	ConflictStatus string   `json:"conflict_status,omitempty"`
}

type persistedAuditFood struct {
	ID              string            `gorm:"column:id"`
	CanonicalName   string            `gorm:"column:canonical_name"`
	NormalizedName  string            `gorm:"column:normalized_name"`
	Source          string            `gorm:"column:source"`
	Kcal            float64           `gorm:"column:kcal_per_100g"`
	Protein         float64           `gorm:"column:protein_per_100g"`
	Carbs           float64           `gorm:"column:carbs_per_100g"`
	Fat             float64           `gorm:"column:fat_per_100g"`
	IsActive        bool              `gorm:"column:is_active"`
	QualityTier     string            `gorm:"column:quality_tier"`
	QualityEvidence datatypes.JSONMap `gorm:"column:quality_evidence"`
}

type aliasAuditConflict struct {
	NormalizedAlias string `gorm:"column:normalized_alias"`
	FoodID          string `gorm:"column:food_id"`
	TargetName      string `gorm:"column:target_name"`
	MatchStatus     string `gorm:"column:match_status"`
}

func auditCandidates(ctx context.Context, db *gorm.DB, candidates []importCandidate, source string, apply bool, report *importReport) error {
	byName := make(map[string]importCandidate, len(candidates))
	for _, candidate := range candidates {
		byName[candidate.NormalizedName] = candidate
	}

	var foods []persistedAuditFood
	if err := db.WithContext(ctx).Table("food_nutrition_library").
		Select("id, canonical_name, normalized_name, source, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_active, quality_tier, quality_evidence").
		Where("source = ?", source).Order("canonical_name ASC").Find(&foods).Error; err != nil {
		return fmt.Errorf("查询待审核来源记录失败: %w", err)
	}
	if len(foods) == 0 {
		return fmt.Errorf("来源 %s 没有可审核记录", source)
	}

	names := make([]string, 0, len(foods))
	for _, food := range foods {
		names = append(names, food.NormalizedName)
	}
	conflicts, err := loadAliasConflicts(ctx, db, names)
	if err != nil {
		return err
	}

	auditedAt := time.Now().UTC()
	audit := &auditReport{
		PolicyVersion: auditPolicyVersion,
		AuditedAt:     auditedAt,
		Total:         len(foods),
		ReasonCounts:  map[string]int{},
		Entries:       make([]auditEntry, 0, len(foods)),
	}
	for _, food := range foods {
		entry := classifyAuditFood(food, byName[food.NormalizedName], conflicts[food.NormalizedName])
		if entry.Decision == "approved" {
			audit.Approved++
		} else {
			audit.NeedsUserReview++
		}
		for _, code := range entry.ReasonCodes {
			audit.ReasonCounts[code]++
		}
		audit.Entries = append(audit.Entries, entry)

		if !apply {
			continue
		}
		evidence := cloneEvidence(food.QualityEvidence)
		evidence["audit_policy_version"] = auditPolicyVersion
		evidence["audit_status"] = entry.Decision
		evidence["audit_reason_codes"] = entry.ReasonCodes
		evidence["audit_reason_labels"] = entry.ReasonLabels
		evidence["audited_at"] = auditedAt.Format(time.RFC3339Nano)
		evidence["audit_method"] = "deterministic checks plus user-authorized assisted review"
		evidence["audit_authorization"] = "2026-08-25: normal rows may pass; ambiguous rows require user review"

		active := entry.Decision == "approved"
		tier := fooddomain.NutritionQualityUnreviewed
		if active {
			tier = fooddomain.NutritionQualityReviewedEstimate
		}
		if err := db.WithContext(ctx).Table("food_nutrition_library").Where("id = ? AND source = ?", food.ID, source).Updates(map[string]any{
			"is_active":           active,
			"quality_tier":        tier,
			"quality_evidence":    evidence,
			"quality_reviewed_at": auditedAt,
			"updated_at":          auditedAt,
		}).Error; err != nil {
			return fmt.Errorf("写入第%d条 %s 的审核结果失败: %w", entry.Sequence, entry.CanonicalName, err)
		}
	}
	sort.Slice(audit.Entries, func(i, j int) bool { return audit.Entries[i].Sequence < audit.Entries[j].Sequence })
	if audit.Approved+audit.NeedsUserReview != audit.Total {
		return fmt.Errorf("审核分组计数不闭合: total=%d approved=%d needs_user_review=%d", audit.Total, audit.Approved, audit.NeedsUserReview)
	}
	if apply {
		verified, verifyErr := verifyAuditState(ctx, db, source, audit.Entries)
		if verifyErr != nil {
			return verifyErr
		}
		audit.Verified = verified
	}
	report.Audit = audit
	return nil
}

func classifyAuditFood(food persistedAuditFood, candidate importCandidate, conflict *aliasAuditConflict) auditEntry {
	reasons := make([]string, 0, 6)
	if candidate.Sequence == 0 {
		reasons = append(reasons, "source_workbook_mismatch")
	}
	if candidate.Sequence > 0 && strings.TrimSpace(food.CanonicalName) != strings.TrimSpace(candidate.CanonicalName) {
		reasons = append(reasons, "canonical_name_changed")
	}
	if candidate.Sequence > 0 && (!almostEqual(food.Kcal, candidate.Kcal) || !almostEqual(food.Protein, candidate.Protein) ||
		!almostEqual(food.Carbs, candidate.Carbs) || !almostEqual(food.Fat, candidate.Fat)) {
		reasons = append(reasons, "nutrition_changed_after_import")
	}
	if conflict != nil && conflict.FoodID != food.ID {
		reasons = append(reasons, "alias_owned_by_other_food")
	}
	if candidate.Sequence > 0 && searchTitleMismatch(evidenceString(candidate.Evidence, "search_term"), candidate.CanonicalName) {
		reasons = append(reasons, "search_title_identity_mismatch")
	}
	reasons = append(reasons, suspiciousTitleReasons(food.CanonicalName)...)

	macroKcal := food.Protein*4 + food.Carbs*4 + food.Fat*9
	if food.Protein+food.Carbs+food.Fat > 100.5 {
		reasons = append(reasons, "macronutrients_exceed_100g")
	}
	if macroKcal-food.Kcal > math.Max(30, food.Kcal*0.20) {
		reasons = append(reasons, "macro_energy_exceeds_declared")
	}
	if food.Kcal-macroKcal > math.Max(80, food.Kcal*0.40) {
		reasons = append(reasons, "declared_energy_far_above_macros")
	}
	reasons = uniqueStrings(reasons)
	labels := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		labels = append(labels, auditReasonLabel(reason))
	}

	entry := auditEntry{
		Sequence: candidate.Sequence, FoodID: food.ID, CanonicalName: food.CanonicalName,
		SearchTerm: evidenceString(candidate.Evidence, "search_term"), Decision: "approved",
		ReasonCodes: reasons, ReasonLabels: labels, Kcal: food.Kcal, Protein: food.Protein,
		Carbs: food.Carbs, Fat: food.Fat, MacroKcal: math.Round(macroKcal*10) / 10,
		MissingFields: evidenceStringSlice(candidate.Evidence, "missing_fields"),
	}
	if len(reasons) > 0 {
		entry.Decision = "needs_user_review"
	}
	if conflict != nil && conflict.FoodID != food.ID {
		entry.ConflictFoodID = conflict.FoodID
		entry.ConflictName = conflict.TargetName
		entry.ConflictStatus = conflict.MatchStatus
	}
	return entry
}

func loadAliasConflicts(ctx context.Context, db *gorm.DB, normalizedNames []string) (map[string]*aliasAuditConflict, error) {
	result := make(map[string]*aliasAuditConflict)
	for start := 0; start < len(normalizedNames); start += 500 {
		end := start + 500
		if end > len(normalizedNames) {
			end = len(normalizedNames)
		}
		var rows []aliasAuditConflict
		if err := db.WithContext(ctx).Table("food_nutrition_aliases AS aliases").
			Select("aliases.normalized_alias, aliases.food_id, foods.canonical_name AS target_name, aliases.match_status").
			Joins("JOIN food_nutrition_library AS foods ON foods.id = aliases.food_id").
			Where("aliases.normalized_alias IN ?", normalizedNames[start:end]).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("查询标准食物别名冲突失败: %w", err)
		}
		for index := range rows {
			row := rows[index]
			result[row.NormalizedAlias] = &row
		}
	}
	return result, nil
}

func verifyAuditState(ctx context.Context, db *gorm.DB, source string, entries []auditEntry) (int, error) {
	var foods []persistedAuditFood
	if err := db.WithContext(ctx).Table("food_nutrition_library").
		Select("id, is_active, quality_tier, quality_evidence").Where("source = ?", source).Find(&foods).Error; err != nil {
		return 0, fmt.Errorf("复核审核状态失败: %w", err)
	}
	expected := make(map[string]auditEntry, len(entries))
	for _, entry := range entries {
		expected[entry.FoodID] = entry
	}
	verified := 0
	for _, food := range foods {
		entry, ok := expected[food.ID]
		if !ok {
			return verified, fmt.Errorf("审核后出现分组外来源记录: %s", food.ID)
		}
		if entry.Decision == "approved" {
			if !food.IsActive || food.QualityTier != fooddomain.NutritionQualityReviewedEstimate {
				return verified, fmt.Errorf("自动通过记录状态错误: %s active=%t tier=%s", entry.CanonicalName, food.IsActive, food.QualityTier)
			}
		} else if food.IsActive || food.QualityTier != fooddomain.NutritionQualityUnreviewed {
			return verified, fmt.Errorf("人工审核记录未保持停用待审: %s active=%t tier=%s", entry.CanonicalName, food.IsActive, food.QualityTier)
		}
		if evidenceString(food.QualityEvidence, "audit_policy_version") != auditPolicyVersion ||
			evidenceString(food.QualityEvidence, "audit_status") != entry.Decision {
			return verified, fmt.Errorf("审核证据未正确写入: %s", entry.CanonicalName)
		}
		verified++
	}
	if verified != len(entries) {
		return verified, fmt.Errorf("审核复核数量不一致: expected=%d actual=%d", len(entries), verified)
	}
	return verified, nil
}

func searchTitleMismatch(searchTerm, title string) bool {
	search := normalizeName(searchTerm)
	actual := normalizeName(title)
	return search != "" && actual != "" && search != actual && !strings.Contains(search, actual) && !strings.Contains(actual, search)
}

func suspiciousTitleReasons(title string) []string {
	trimmed := strings.TrimSpace(title)
	reasons := make([]string, 0, 3)
	if utf8.RuneCountInString(normalizeName(trimmed)) <= 1 {
		reasons = append(reasons, "title_too_short")
	}
	if strings.Count(trimmed, "(") != strings.Count(trimmed, ")") || strings.Count(trimmed, "（") != strings.Count(trimmed, "）") ||
		strings.Contains(trimmed, "， )") || strings.Contains(trimmed, ", )") || strings.Contains(trimmed, "、 )") ||
		strings.Contains(trimmed, " )") || strings.Contains(trimmed, "，）") || strings.Contains(trimmed, ",）") {
		reasons = append(reasons, "title_bracket_or_truncation_anomaly")
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 2 && utf8.RuneCountInString(parts[0]) <= 1 && utf8.RuneCountInString(normalizeName(trimmed)) <= 5 {
		reasons = append(reasons, "short_split_title_ambiguous")
	}
	return reasons
}

func auditReasonLabel(code string) string {
	labels := map[string]string{
		"source_workbook_mismatch":            "数据库记录无法与本批工作簿逐行对应",
		"canonical_name_changed":              "导入后标准名称发生变化",
		"nutrition_changed_after_import":      "导入后核心营养值发生变化",
		"alias_owned_by_other_food":           "同名已被其他标准食物别名占用",
		"search_title_identity_mismatch":      "搜索词与实际条目名称明显不一致",
		"title_too_short":                     "名称过短，无法可靠确认食物身份",
		"title_bracket_or_truncation_anomaly": "名称括号或结尾疑似截断",
		"short_split_title_ambiguous":         "短名称含异常空格或疑似倒装",
		"macronutrients_exceed_100g":          "每100克三大营养素合计超过100克",
		"macro_energy_exceeds_declared":       "三大营养素折算热量明显高于标称热量",
		"declared_energy_far_above_macros":    "标称热量明显高于三大营养素折算热量",
	}
	if label := labels[code]; label != "" {
		return label
	}
	return code
}

func evidenceString(evidence datatypes.JSONMap, key string) string {
	if evidence == nil {
		return ""
	}
	value, _ := evidence[key].(string)
	return strings.TrimSpace(value)
}

func evidenceStringSlice(evidence datatypes.JSONMap, key string) []string {
	if evidence == nil {
		return nil
	}
	switch values := evidence[key].(type) {
	case []string:
		return append([]string(nil), values...)
	case []any:
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func cloneEvidence(source datatypes.JSONMap) datatypes.JSONMap {
	result := make(datatypes.JSONMap, len(source)+8)
	for key, value := range source {
		result[key] = value
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
