package service

import (
	"context"
	"fmt"
	"math"
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
	Gender           *string                      `json:"gender"`
	Birthday         *string                      `json:"birthday"`
	Height           *float64                     `json:"height"`
	Weight           *float64                     `json:"weight"`
	ActivityLevel    *string                      `json:"activity_level"`
	DietGoal         *string                      `json:"diet_goal"`
	ExecutionMode    *string                      `json:"execution_mode"`
	ModeSetBy        *string                      `json:"mode_set_by"`
	ModeReason       *string                      `json:"mode_reason"`
	MedicalHistory   *string                      `json:"medical_history"`
	DietPreference   *string                      `json:"diet_preference"`
	Allergies        *string                      `json:"allergies"`
	HealthNotes      *string                      `json:"health_notes"`
	DashboardTargets *UpdateDashboardTargetsInput `json:"dashboard_targets"`
	ReportExtract    map[string]any               `json:"report_extract"`
	ReportImageURL   *string                      `json:"report_image_url"`
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
		healthCondition["medical_history"] = *input.MedicalHistory
	}
	if input.DietPreference != nil {
		healthCondition["diet_preference"] = *input.DietPreference
	}
	if input.Allergies != nil {
		healthCondition["allergies"] = *input.Allergies
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
		"health_condition":      user.HealthCondition,
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
		"health_condition":      user.HealthCondition,
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
