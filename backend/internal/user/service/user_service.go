package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"
)

const (
	defaultExecutionMode = "standard"
	validExecutionMode   = "strict"
)

var validModeSetBy = map[string]bool{"system": true, "user_manual": true, "coach_manual": true}

type UserService struct {
	users         *repo.UserRepo
	healthDocs    *userrepo.HealthDocumentRepo
	modeSwitchLog *userrepo.ModeSwitchLogRepo
}

func NewUserService(users *repo.UserRepo, healthDocs *userrepo.HealthDocumentRepo, modeSwitchLog *userrepo.ModeSwitchLogRepo) *UserService {
	return &UserService{users: users, healthDocs: healthDocs, modeSwitchLog: modeSwitchLog}
}

func (s *UserService) GetProfile(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return buildProfileResponse(user), nil
}

type UpdateProfileInput struct {
	Nickname      *string `json:"nickname"`
	Avatar        *string `json:"avatar"`
	Telephone     *string `json:"telephone"`
	Searchable    *bool   `json:"searchable"`
	PublicRecords *bool   `json:"public_records"`
}

func (s *UserService) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (map[string]any, error) {
	updates := map[string]any{}
	if input.Nickname != nil {
		updates["nickname"] = *input.Nickname
	}
	if input.Avatar != nil {
		updates["avatar"] = *input.Avatar
	}
	if input.Telephone != nil {
		updates["telephone"] = *input.Telephone
	}
	if input.Searchable != nil {
		updates["searchable"] = *input.Searchable
	}
	if input.PublicRecords != nil {
		updates["public_records"] = *input.PublicRecords
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有要更新的字段", HTTPStatus: 400}
	}
	user, err := s.users.UpdateFields(ctx, userID, updates)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":             user.ID,
		"openid":         user.OpenID,
		"unionid":        user.UnionID,
		"nickname":       user.Nickname,
		"avatar":         user.Avatar,
		"telephone":      user.Telephone,
		"create_time":    user.CreatedAt,
		"searchable":     user.Searchable,
		"public_records": user.PublicRecords,
	}, nil
}

func (s *UserService) GetDashboardTargets(ctx context.Context, userID string) (map[string]float64, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return buildDashboardTargets(user), nil
}

type UpdateDashboardTargetsInput struct {
	CalorieTarget float64 `json:"calorie_target"`
	ProteinTarget float64 `json:"protein_target"`
	CarbsTarget   float64 `json:"carbs_target"`
	FatTarget     float64 `json:"fat_target"`
}

func (s *UserService) UpdateDashboardTargets(ctx context.Context, userID string, input UpdateDashboardTargetsInput) (map[string]float64, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	healthCondition["dashboard_targets"] = map[string]float64{
		"calorie_target": math.Round(input.CalorieTarget*10) / 10,
		"protein_target": math.Round(input.ProteinTarget*10) / 10,
		"carbs_target":   math.Round(input.CarbsTarget*10) / 10,
		"fat_target":     math.Round(input.FatTarget*10) / 10,
	}
	updated, err := s.users.UpdateFields(ctx, userID, map[string]any{"health_condition": healthCondition})
	if err != nil {
		return nil, err
	}
	return buildDashboardTargets(updated), nil
}

func (s *UserService) GetHealthProfile(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return buildHealthProfileResponse(user), nil
}

type UpdateHealthProfileInput struct {
	Gender                     *string                      `json:"gender"`
	Birthday                   *string                      `json:"birthday"`
	Height                     *float64                     `json:"height"`
	Weight                     *float64                     `json:"weight"`
	ActivityLevel              *string                      `json:"activity_level"`
	DietGoal                   *string                      `json:"diet_goal"`
	ExecutionMode              *string                      `json:"execution_mode"`
	ModeSetBy                  *string                      `json:"mode_set_by"`
	ModeReason                 *string                      `json:"mode_reason"`
	MedicalHistory             *StringList                  `json:"medical_history"`
	DietPreference             *StringList                  `json:"diet_preference"`
	Allergies                  *StringList                  `json:"allergies"`
	HealthNotes                *string                      `json:"health_notes"`
	DashboardTargets           *UpdateDashboardTargetsInput `json:"dashboard_targets"`
	ReportExtract              map[string]any               `json:"report_extract"`
	ReportImageURL             *string                      `json:"report_image_url"`
	PrecisionReferenceDefaults map[string]any               `json:"precision_reference_defaults"`
}

type StringList []string

func (s *StringList) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*s = nil
		return nil
	}
	var list []string
	if err := json.Unmarshal(data, &list); err == nil {
		*s = cleanStringList(list)
		return nil
	}
	var single string
	if err := json.Unmarshal(data, &single); err != nil {
		return err
	}
	*s = cleanStringList([]string{single})
	return nil
}

func (s *UserService) UpdateHealthProfile(ctx context.Context, userID string, input UpdateHealthProfileInput) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}

	updates := map[string]any{}
	if input.Gender != nil {
		updates["gender"] = *input.Gender
	}
	if input.Birthday != nil {
		updates["birthday"] = *input.Birthday
	}
	if input.Height != nil {
		updates["height"] = *input.Height
	}
	if input.Weight != nil {
		updates["weight"] = *input.Weight
	}
	if input.ActivityLevel != nil {
		updates["activity_level"] = *input.ActivityLevel
	}
	if input.DietGoal != nil {
		updates["diet_goal"] = *input.DietGoal
	}

	currentMode := normalizeExecutionMode(user.ExecutionMode)
	requestedMode := input.ExecutionMode
	modeChanged := false
	modeChangeFrom := currentMode
	modeChangeTo := currentMode
	modeChangeSetBy := "user_manual"
	var modeChangeReason *string

	if requestedMode != nil {
		mode := normalizeExecutionMode(requestedMode)
		updates["execution_mode"] = mode
		modeChangeTo = mode
		modeChanged = mode != currentMode
		if modeChanged {
			rawSetBy := "user_manual"
			if input.ModeSetBy != nil {
				rawSetBy = *input.ModeSetBy
			}
			if !validModeSetBy[rawSetBy] {
				return nil, &commonerrors.AppError{Code: 10002, Message: "mode_set_by 不合法", HTTPStatus: 400}
			}
			modeChangeSetBy = rawSetBy
			if input.ModeReason != nil && *input.ModeReason != "" {
				modeChangeReason = input.ModeReason
			}
			updates["mode_set_by"] = modeChangeSetBy
			updates["mode_set_at"] = time.Now().UTC()
			updates["mode_reason"] = modeChangeReason
			prevCount := 0
			if user.ModeSwitchCount30d != nil {
				prevCount = *user.ModeSwitchCount30d
			}
			updates["mode_switch_count_30d"] = prevCount + 1
		}
	}

	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	if input.MedicalHistory != nil {
		healthCondition["medical_history"] = []string(*input.MedicalHistory)
	}
	if input.DietPreference != nil {
		healthCondition["diet_preference"] = []string(*input.DietPreference)
	}
	if input.Allergies != nil {
		healthCondition["allergies"] = []string(*input.Allergies)
	}
	if input.HealthNotes != nil {
		healthCondition["health_notes"] = *input.HealthNotes
	}
	if input.DashboardTargets != nil {
		dt := input.DashboardTargets
		healthCondition["dashboard_targets"] = map[string]float64{
			"calorie_target": math.Round(dt.CalorieTarget*10) / 10,
			"protein_target": math.Round(dt.ProteinTarget*10) / 10,
			"carbs_target":   math.Round(dt.CarbsTarget*10) / 10,
			"fat_target":     math.Round(dt.FatTarget*10) / 10,
		}
	}
	if input.PrecisionReferenceDefaults != nil {
		if normalized := normalizePrecisionReferenceDefaults(input.PrecisionReferenceDefaults); len(normalized) > 0 {
			healthCondition["precision_reference_defaults"] = normalized
		} else {
			delete(healthCondition, "precision_reference_defaults")
		}
	}

	if input.ReportExtract != nil && len(input.ReportExtract) > 0 {
		doc := &domain.UserHealthDocument{
			UserID:           userID,
			DocumentType:     "report",
			ImageURL:         input.ReportImageURL,
			ExtractedContent: input.ReportExtract,
		}
		if err := s.healthDocs.Create(ctx, doc); err != nil {
			// Log error but don't fail the whole request
			fmt.Printf("[update_health_profile] write health document failed: %v\n", err)
		}
		healthCondition["report_extract"] = input.ReportExtract
	}

	updates["health_condition"] = healthCondition

	gender := updates["gender"]
	if gender == nil {
		gender = user.Gender
	}
	weight := updates["weight"]
	if weight == nil {
		weight = user.Weight
	}
	activityLevel := "sedentary"
	if input.ActivityLevel != nil {
		activityLevel = *input.ActivityLevel
	} else if user.ActivityLevel != nil {
		activityLevel = *user.ActivityLevel
	}

	if gender != nil && weight != nil {
		g := ""
		if v, ok := gender.(string); ok {
			g = v
		} else if user.Gender != nil {
			g = *user.Gender
		}
		var w float64
		if v, ok := weight.(float64); ok {
			w = v
		} else if user.Weight != nil {
			w = *user.Weight
		}
		if g != "" && w > 0 {
			bmr := CalculateBMR(g, w)
			tdee := CalculateTDEE(bmr, activityLevel)
			updates["bmr"] = math.Round(bmr*10) / 10
			updates["tdee"] = math.Round(tdee*10) / 10
		}
	}

	updates["onboarding_completed"] = true

	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有要更新的字段", HTTPStatus: 400}
	}

	updated, err := s.users.UpdateFields(ctx, userID, updates)
	if err != nil {
		return nil, err
	}

	if modeChanged {
		log := &domain.UserModeSwitchLog{
			UserID:     userID,
			FromMode:   modeChangeFrom,
			ToMode:     modeChangeTo,
			ChangedBy:  modeChangeSetBy,
			ReasonCode: modeChangeReason,
		}
		if err := s.modeSwitchLog.Create(ctx, log); err != nil {
			fmt.Printf("[update_health_profile] write mode switch log failed: %v\n", err)
		}
	}

	return buildHealthProfileResponse(updated), nil
}

func (s *UserService) GetRecordDays(ctx context.Context, userID string) (int64, error) {
	return s.users.CountFoodRecordDays(ctx, userID)
}

func (s *UserService) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return s.users.UpdateLastSeenAnalyzeHistory(ctx, userID)
}

func buildProfileResponse(user *repo.User) map[string]any {
	return map[string]any{
		"id":                    user.ID,
		"openid":                user.OpenID,
		"unionid":               user.UnionID,
		"nickname":              user.Nickname,
		"avatar":                user.Avatar,
		"telephone":             user.Telephone,
		"create_time":           user.CreatedAt,
		"height":                user.Height,
		"weight":                user.Weight,
		"birthday":              user.Birthday,
		"gender":                user.Gender,
		"activity_level":        user.ActivityLevel,
		"health_condition":      normalizeHealthConditionResponse(user.HealthCondition),
		"bmr":                   user.BMR,
		"tdee":                  user.TDEE,
		"onboarding_completed":  user.OnboardingCompleted,
		"diet_goal":             user.DietGoal,
		"execution_mode":        normalizeExecutionMode(user.ExecutionMode),
		"mode_set_by":           user.ModeSetBy,
		"mode_set_at":           user.ModeSetAt,
		"mode_reason":           user.ModeReason,
		"mode_commitment_days":  user.ModeCommitmentDays,
		"mode_switch_count_30d": user.ModeSwitchCount30d,
		"searchable":            user.Searchable,
		"public_records":        user.PublicRecords,
	}
}

func buildHealthProfileResponse(user *repo.User) map[string]any {
	return map[string]any{
		"height":                user.Height,
		"weight":                user.Weight,
		"birthday":              user.Birthday,
		"gender":                user.Gender,
		"activity_level":        user.ActivityLevel,
		"health_condition":      normalizeHealthConditionResponse(user.HealthCondition),
		"bmr":                   user.BMR,
		"tdee":                  user.TDEE,
		"onboarding_completed":  user.OnboardingCompleted,
		"diet_goal":             user.DietGoal,
		"execution_mode":        normalizeExecutionMode(user.ExecutionMode),
		"mode_set_by":           user.ModeSetBy,
		"mode_set_at":           user.ModeSetAt,
		"mode_reason":           user.ModeReason,
		"mode_commitment_days":  user.ModeCommitmentDays,
		"mode_switch_count_30d": user.ModeSwitchCount30d,
	}
}

func buildDashboardTargets(user *repo.User) map[string]float64 {
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	dashboardTargets, _ := healthCondition["dashboard_targets"].(map[string]any)
	if dashboardTargets == nil {
		dashboardTargets = map[string]any{}
	}

	calorieTarget := 2000.0
	if v, ok := dashboardTargets["calorie_target"]; ok && v != nil {
		if f, ok2 := v.(float64); ok2 {
			calorieTarget = f
		}
	} else if user.TDEE != nil && *user.TDEE > 0 {
		calorieTarget = *user.TDEE
	}

	defaults := GetDashboardDefaultMacroTargets()
	protein := defaults["protein"]
	carbs := defaults["carbs"]
	fat := defaults["fat"]

	if v, ok := dashboardTargets["protein_target"]; ok && v != nil {
		if f, ok2 := v.(float64); ok2 {
			protein = f
		}
	}
	if v, ok := dashboardTargets["carbs_target"]; ok && v != nil {
		if f, ok2 := v.(float64); ok2 {
			carbs = f
		}
	}
	if v, ok := dashboardTargets["fat_target"]; ok && v != nil {
		if f, ok2 := v.(float64); ok2 {
			fat = f
		}
	}

	return map[string]float64{
		"calorie_target": math.Round(calorieTarget*10) / 10,
		"protein_target": math.Round(protein*10) / 10,
		"carbs_target":   math.Round(carbs*10) / 10,
		"fat_target":     math.Round(fat*10) / 10,
	}
}

func cleanStringList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		cleaned := strings.TrimSpace(value)
		if cleaned == "" || seen[cleaned] {
			continue
		}
		seen[cleaned] = true
		out = append(out, cleaned)
	}
	return out
}

func normalizeHealthConditionResponse(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		out[key] = value
	}
	for _, key := range []string{"medical_history", "diet_preference", "allergies"} {
		switch v := out[key].(type) {
		case []string:
			out[key] = cleanStringList(v)
		case []any:
			values := make([]string, 0, len(v))
			for _, item := range v {
				values = append(values, fmt.Sprintf("%v", item))
			}
			out[key] = cleanStringList(values)
		case string:
			out[key] = cleanStringList([]string{v})
		case nil:
			out[key] = []string{}
		}
	}
	if raw, ok := out["precision_reference_defaults"].(map[string]any); ok {
		out["precision_reference_defaults"] = normalizePrecisionReferenceDefaults(raw)
	}
	return out
}

func normalizePrecisionReferenceDefaults(input map[string]any) map[string]any {
	out := map[string]any{}
	if key := strings.TrimSpace(fmt.Sprintf("%v", input["preferred_reference_key"])); key != "" && key != "<nil>" {
		out["preferred_reference_key"] = key
	}
	if presets, ok := input["presets"].(map[string]any); ok && len(presets) > 0 {
		cleaned := map[string]any{}
		for key, raw := range presets {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			if cfg, ok := raw.(map[string]any); ok {
				name := strings.TrimSpace(fmt.Sprintf("%v", cfg["reference_name"]))
				if name == "" || name == "<nil>" {
					continue
				}
				item := map[string]any{"reference_name": name}
				if dims, ok := cfg["dimensions_mm"].(map[string]any); ok && len(dims) > 0 {
					item["dimensions_mm"] = dims
				}
				cleaned[key] = item
			}
		}
		if len(cleaned) > 0 {
			out["presets"] = cleaned
		}
	}
	return out
}

func normalizeExecutionMode(mode *string) string {
	if mode == nil {
		return defaultExecutionMode
	}
	m := *mode
	if m == validExecutionMode {
		return m
	}
	return defaultExecutionMode
}
