package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/nickname"
	userrepo "food_link/backend/internal/user/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"log/slog"
)

const (
	defaultExecutionMode      = "standard"
	standardWebSearchMode     = "standard_web_search"
	fastExecutionMode         = "fast"
	fastWebSearchMode         = "fast_web_search"
	validExecutionMode        = "strict"
	strictWebSearchMode       = "strict_web_search"
	experimentalExecutionMode = "experimental"
	gemini35FlashMode         = "gemini35_flash"
	gemini35GroupedMode       = "gemini35_flash_grouped"
)

var validModeSetBy = map[string]bool{"system": true, "user_manual": true, "coach_manual": true}

type UserService struct {
	users         *repo.UserRepo
	healthDocs    *userrepo.HealthDocumentRepo
	modeSwitchLog *userrepo.ModeSwitchLogRepo
	storage       *storage.Client
	blockChecker  BlockChecker
}

type BlockChecker interface {
	IsBlockedEither(ctx context.Context, userA, userB string) (bool, error)
}

func NewUserService(users *repo.UserRepo, healthDocs *userrepo.HealthDocumentRepo, modeSwitchLog *userrepo.ModeSwitchLogRepo, storageClient ...*storage.Client) *UserService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &UserService{users: users, healthDocs: healthDocs, modeSwitchLog: modeSwitchLog, storage: client}
}

func (s *UserService) ConfigureBlockChecker(checker BlockChecker) {
	s.blockChecker = checker
}

func (s *UserService) GetProfile(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.buildProfileResponse(user), nil
}

type UpdateProfileInput struct {
	Nickname              *string `json:"nickname"`
	Avatar                *string `json:"avatar"`
	CoverImage            *string `json:"cover_image"`
	Telephone             *string `json:"telephone"`
	Searchable            *bool   `json:"searchable"`
	PublicRecords         *bool   `json:"public_records"`
	PublicFavoriteRecipes *bool   `json:"public_favorite_recipes"`
	Motto                 *string `json:"motto"`
}

func (s *UserService) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (map[string]any, error) {
	updates := map[string]any{}
	if input.Nickname != nil {
		validatedNickname, err := nickname.Validate(*input.Nickname)
		if err != nil {
			return nil, err
		}
		updates["nickname"] = validatedNickname
	}
	if input.Avatar != nil {
		updates["avatar"] = s.resolveAvatarURL(*input.Avatar)
	}
	if input.CoverImage != nil {
		updates["cover_image"] = s.resolveCoverImageURL(*input.CoverImage)
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
	if input.PublicFavoriteRecipes != nil {
		updates["public_favorite_recipes"] = *input.PublicFavoriteRecipes
	}
	if input.Motto != nil {
		updates["motto"] = *input.Motto
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有要更新的字段", HTTPStatus: 400}
	}
	user, err := s.users.UpdateFields(ctx, userID, updates)
	if err != nil {
		return nil, err
	}
	return s.buildProfileResponse(user), nil
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
	CalorieTarget float64            `json:"calorie_target"`
	ProteinTarget float64            `json:"protein_target"`
	CarbsTarget   float64            `json:"carbs_target"`
	FatTarget     float64            `json:"fat_target"`
	MicroTargets  map[string]float64 `json:"micro_targets"`
	TargetDate    string             `json:"target_date"`
}

func (s *UserService) UpdateDashboardTargets(ctx context.Context, userID string, input UpdateDashboardTargetsInput) (map[string]float64, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	targets := map[string]float64{
		"calorie_target": math.Round(input.CalorieTarget*10) / 10,
		"protein_target": math.Round(input.ProteinTarget*10) / 10,
		"carbs_target":   math.Round(input.CarbsTarget*10) / 10,
		"fat_target":     math.Round(input.FatTarget*10) / 10,
	}
	for key, value := range input.MicroTargets {
		targets[key] = math.Round(value*10) / 10
	}
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	healthCondition["dashboard_targets"] = targets
	healthCondition["dashboard_targets_mode"] = "manual"
	healthCondition["dashboard_targets_updated_at"] = time.Now().UTC().Format(time.RFC3339)
	updated, err := s.users.UpdateFields(ctx, userID, map[string]any{"health_condition": datatypes.JSONMap(healthCondition)})
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
	return s.buildHealthProfileResponse(user), nil
}

type UpdateHealthProfileInput struct {
	// OnboardingStatus is optional. Old clients omit it and retain the legacy
	// behavior: a normal full health-profile save becomes completed.
	OnboardingStatus           *string                      `json:"onboarding_status"`
	OnboardingDraftStep        *int                         `json:"onboarding_draft_step"`
	Gender                     *string                      `json:"gender"`
	Birthday                   *string                      `json:"birthday"`
	Height                     *float64                     `json:"height"`
	Weight                     *float64                     `json:"weight"`
	ActivityLevel              *string                      `json:"activity_level"`
	DailyLifeActivityLevel     *string                      `json:"daily_life_activity_level"`
	DietGoal                   *string                      `json:"diet_goal"`
	ExecutionMode              *string                      `json:"execution_mode"`
	ModeSetBy                  *string                      `json:"mode_set_by"`
	ModeReason                 *string                      `json:"mode_reason"`
	MedicalHistory             *StringList                  `json:"medical_history"`
	DietPreference             *StringList                  `json:"diet_preference"`
	Allergies                  *StringList                  `json:"allergies"`
	HealthNotes                *string                      `json:"health_notes"`
	RoutineType                *string                      `json:"routine_type"`
	RoutineSleepHour           *int                         `json:"routine_sleep_hour"`
	RoutineWakeHour            *int                         `json:"routine_wake_hour"`
	DashboardTargets           *UpdateDashboardTargetsInput `json:"dashboard_targets"`
	ReportExtract              map[string]any               `json:"report_extract"`
	ReportImageURL             *string                      `json:"report_image_url"`
	PrecisionReferenceDefaults map[string]any               `json:"precision_reference_defaults"`
	CampusDiningPreference     *CampusDiningPreferenceInput `json:"campus_dining_preference"`
}

type CampusDiningPreferenceInput struct {
	SchoolID string `json:"school_id"`
	CampusID string `json:"campus_id,omitempty"`
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
		updates["activity_level"] = NormalizeDailyLifeActivityLevel(*input.ActivityLevel)
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
	if input.RoutineType != nil {
		healthCondition["routine_type"] = strings.TrimSpace(*input.RoutineType)
	}
	if input.RoutineSleepHour != nil {
		healthCondition["routine_sleep_hour"] = *input.RoutineSleepHour
	}
	if input.RoutineWakeHour != nil {
		healthCondition["routine_wake_hour"] = *input.RoutineWakeHour
	}
	if input.DailyLifeActivityLevel != nil {
		normalized := NormalizeDailyLifeActivityLevel(*input.DailyLifeActivityLevel)
		healthCondition["daily_life_activity_level"] = normalized
		updates["activity_level"] = normalized
	} else if input.ActivityLevel != nil {
		healthCondition["daily_life_activity_level"] = NormalizeDailyLifeActivityLevel(*input.ActivityLevel)
	}
	if input.DashboardTargets != nil {
		dt := input.DashboardTargets
		healthCondition["dashboard_targets"] = map[string]float64{
			"calorie_target": math.Round(dt.CalorieTarget*10) / 10,
			"protein_target": math.Round(dt.ProteinTarget*10) / 10,
			"carbs_target":   math.Round(dt.CarbsTarget*10) / 10,
			"fat_target":     math.Round(dt.FatTarget*10) / 10,
		}
		healthCondition["dashboard_targets_mode"] = "manual"
		healthCondition["dashboard_targets_updated_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	if input.PrecisionReferenceDefaults != nil {
		if normalized := normalizePrecisionReferenceDefaults(input.PrecisionReferenceDefaults); len(normalized) > 0 {
			healthCondition["precision_reference_defaults"] = normalized
		} else {
			delete(healthCondition, "precision_reference_defaults")
		}
	}
	if input.CampusDiningPreference != nil {
		preference, err := s.resolveCampusDiningPreference(ctx, *input.CampusDiningPreference)
		if err != nil {
			return nil, err
		}
		if preference == nil {
			delete(healthCondition, "campus_dining_preference")
		} else {
			healthCondition["campus_dining_preference"] = preference
		}
	}

	if input.ReportImageURL != nil {
		normalizedReportURL := s.resolveHealthReportURL(*input.ReportImageURL)
		input.ReportImageURL = &normalizedReportURL
	}

	if input.ReportExtract != nil && len(input.ReportExtract) > 0 {
		doc := &domain.UserHealthDocument{
			UserID:           userID,
			DocumentType:     "report",
			ImageURL:         input.ReportImageURL,
			ExtractedContent: input.ReportExtract,
		}
		if err := s.healthDocs.Create(ctx, doc); err != nil {
			logger.Warn(ctx, "健康档案报告文档写入失败，继续保存档案",
				slog.String("user_id", userID),
				logger.Err(err),
			)
		}
		healthCondition["report_extract"] = input.ReportExtract
	}

	updates["health_condition"] = healthCondition

	gender := updates["gender"]
	if gender == nil {
		gender = user.Gender
	}
	birthday := updates["birthday"]
	if birthday == nil {
		birthday = user.Birthday
	}
	height := updates["height"]
	if height == nil {
		height = user.Height
	}
	weight := updates["weight"]
	if weight == nil {
		weight = user.Weight
	}
	activityLevel := resolveDailyLifeActivityLevel(user, healthCondition)
	if input.DailyLifeActivityLevel != nil {
		activityLevel = NormalizeDailyLifeActivityLevel(*input.DailyLifeActivityLevel)
	} else if input.ActivityLevel != nil {
		activityLevel = NormalizeDailyLifeActivityLevel(*input.ActivityLevel)
	}

	if gender != nil && weight != nil {
		g := ""
		if v, ok := gender.(string); ok {
			g = v
		} else if user.Gender != nil {
			g = *user.Gender
		}
		bday := ""
		if v, ok := birthday.(string); ok {
			bday = v
		} else if user.Birthday != nil {
			bday = *user.Birthday
		}
		var h float64
		if v, ok := height.(float64); ok {
			h = v
		} else if user.Height != nil {
			h = *user.Height
		}
		var w float64
		if v, ok := weight.(float64); ok {
			w = v
		} else if user.Weight != nil {
			w = *user.Weight
		}
		if g != "" && w > 0 {
			stable := CalculateStableNutritionTargets(StableNutritionTargetInput{
				Gender:        g,
				WeightKg:      w,
				HeightCm:      h,
				Birthday:      bday,
				ActivityLevel: activityLevel,
				DietGoal:      derefStringPtr(input.DietGoal, user.DietGoal),
				Now:           time.Now(),
			})
			updates["bmr"] = stable.BMR
			updates["tdee"] = stable.TDEE
			if input.DashboardTargets == nil && !hasDashboardTargets(healthCondition) {
				healthCondition["dashboard_targets"] = stable.Targets
				healthCondition["dashboard_targets_mode"] = "system_initial"
				healthCondition["dashboard_targets_updated_at"] = time.Now().UTC().Format(time.RFC3339)
				healthCondition["dashboard_targets_generated_at"] = time.Now().UTC().Format(time.RFC3339)
				updates["health_condition"] = healthCondition
			}
		}
	}

	status, err := resolveOnboardingStatusUpdate(user, input.OnboardingStatus)
	if err != nil {
		return nil, err
	}
	updates["onboarding_status"] = status
	if status == onboardingStatusPending {
		if input.OnboardingDraftStep == nil || *input.OnboardingDraftStep < 0 || *input.OnboardingDraftStep > 12 {
			return nil, &commonerrors.AppError{Code: 10002, Message: "健康档案草稿进度无效", HTTPStatus: 400}
		}
		updates["onboarding_draft_step"] = *input.OnboardingDraftStep
	} else {
		updates["onboarding_draft_step"] = nil
	}
	// Keep the legacy boolean unchanged in the API contract: old Mini Program
	// releases only understand “pending” versus a terminal onboarding state.
	updates["onboarding_completed"] = status != onboardingStatusPending

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
			logger.Warn(ctx, "健康档案模式切换日志写入失败",
				slog.String("user_id", userID),
				slog.String("mode.from", modeChangeFrom),
				slog.String("mode.to", modeChangeTo),
				logger.Err(err),
			)
		}
	}

	return s.buildHealthProfileResponse(updated), nil
}

func (s *UserService) resolveCampusDiningPreference(ctx context.Context, input CampusDiningPreferenceInput) (map[string]any, error) {
	schoolID := strings.TrimSpace(input.SchoolID)
	campusID := strings.TrimSpace(input.CampusID)
	if schoolID == "" {
		return nil, nil
	}

	var school struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if err := s.users.DB().WithContext(ctx).
		Table("schools").
		Select("id, name").
		Where("id = ? AND status = ?", schoolID, "active").
		Take(&school).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "请选择有效的学校", HTTPStatus: 400}
		}
		return nil, err
	}

	preference := map[string]any{
		"school_id":   school.ID,
		"school_name": strings.TrimSpace(school.Name),
	}
	if campusID == "" {
		return preference, nil
	}

	var campus struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if err := s.users.DB().WithContext(ctx).
		Table("school_campuses").
		Select("id, name").
		Where("id = ? AND school_id = ? AND status = ?", campusID, schoolID, "active").
		Take(&campus).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "请选择该学校下的有效校区", HTTPStatus: 400}
		}
		return nil, err
	}
	preference["campus_id"] = campus.ID
	preference["campus_name"] = strings.TrimSpace(campus.Name)
	return preference, nil
}

func (s *UserService) GetRecordDays(ctx context.Context, userID string) (int64, error) {
	return s.users.CountFoodRecordDays(ctx, userID)
}

// GetPublicProfile 返回其他用户的公开信息（脱敏）
func (s *UserService) GetPublicProfile(ctx context.Context, viewerUserID, targetUserID string) (map[string]any, error) {
	viewerUserID = strings.TrimSpace(viewerUserID)
	targetUserID = strings.TrimSpace(targetUserID)
	if viewerUserID != "" && viewerUserID != targetUserID && s.blockChecker != nil {
		blocked, err := s.blockChecker.IsBlockedEither(ctx, viewerUserID, targetUserID)
		if err != nil {
			return nil, err
		}
		if blocked {
			return nil, commonerrors.ErrNotFound
		}
	}
	user, err := s.users.FindByID(ctx, targetUserID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	recordDays, _ := s.users.CountFoodRecordDays(ctx, targetUserID)
	return map[string]any{
		"id":                      user.ID,
		"nickname":                user.Nickname,
		"avatar":                  s.resolveAvatarURL(user.Avatar),
		"cover_image":             s.resolveCoverImageURL(user.CoverImage),
		"record_days":             recordDays,
		"create_time":             user.CreatedAt,
		"motto":                   user.Motto,
		"public_favorite_recipes": user.PublicFavoriteRecipes == nil || *user.PublicFavoriteRecipes,
	}, nil
}

func (s *UserService) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return s.users.UpdateLastSeenAnalyzeHistory(ctx, userID)
}

func (s *UserService) AcknowledgeHealthDisclaimer(ctx context.Context, userID string) error {
	return s.users.UpdateHealthDisclaimerAcknowledged(ctx, userID)
}

func (s *UserService) DeleteAccount(ctx context.Context, userID string) error {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		logger.Error(ctx, "查询待注销用户失败", err, slog.String("user_id", userID))
		return err
	}
	if user == nil {
		logger.Warn(ctx, "注销账号失败，用户不存在", slog.String("user_id", userID))
		return commonerrors.ErrNotFound
	}

	if err := s.users.DeleteByID(ctx, userID); err != nil {
		logger.Error(ctx, "注销账号失败", err, slog.String("user_id", userID))
		return err
	}

	logger.Info(ctx, "注销账号完成", slog.String("user_id", userID))
	return nil
}

func (s *UserService) buildProfileResponse(user *repo.User) map[string]any {
	out := buildProfileResponseWithStorage(user, s.storage)
	out["avatar"] = s.resolveAvatarURL(user.Avatar)
	out["cover_image"] = s.resolveCoverImageURL(user.CoverImage)
	return out
}

func (s *UserService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveUserAvatarURL(value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *UserService) resolveCoverImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("user-avatars", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *UserService) resolveHealthReportURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("health-reports", value)
	if resolved == "" {
		return value
	}
	return resolved
}

const (
	onboardingStatusPending   = "pending"
	onboardingStatusSkipped   = "skipped"
	onboardingStatusCompleted = "completed"
)

func resolveOnboardingStatus(user *repo.User) string {
	if user != nil && user.OnboardingStatus != nil {
		switch strings.TrimSpace(*user.OnboardingStatus) {
		case onboardingStatusPending, onboardingStatusSkipped, onboardingStatusCompleted:
			return strings.TrimSpace(*user.OnboardingStatus)
		}
	}
	if user != nil && user.OnboardingCompleted != nil && *user.OnboardingCompleted {
		return onboardingStatusCompleted
	}
	return onboardingStatusPending
}

func resolveOnboardingStatusUpdate(user *repo.User, requested *string) (string, error) {
	if requested == nil {
		// Preserve the historical contract: a normal PUT health-profile is a
		// completed questionnaire submission, even for old Mini Program clients.
		return onboardingStatusCompleted, nil
	}
	status := strings.TrimSpace(*requested)
	if status != onboardingStatusPending && status != onboardingStatusSkipped {
		return "", &commonerrors.AppError{Code: 10002, Message: "无效的健康档案引导状态", HTTPStatus: 400}
	}
	if status == onboardingStatusPending && resolveOnboardingStatus(user) == onboardingStatusCompleted {
		return "", &commonerrors.AppError{Code: 10002, Message: "健康档案已完成，无需保存草稿", HTTPStatus: 400}
	}
	if resolveOnboardingStatus(user) == onboardingStatusCompleted {
		return "", &commonerrors.AppError{Code: 10002, Message: "健康档案已完成，无需跳过", HTTPStatus: 400}
	}
	return onboardingStatusSkipped, nil
}

func buildProfileResponse(user *repo.User) map[string]any {
	return buildProfileResponseWithStorage(user, nil)
}

func buildProfileResponseWithStorage(user *repo.User, storageClient *storage.Client) map[string]any {
	onboardingStatus := resolveOnboardingStatus(user)
	return map[string]any{
		"id":                      user.ID,
		"openid":                  user.OpenID,
		"unionid":                 user.UnionID,
		"username":                user.Username,
		"has_password":            user.PasswordHash != nil && strings.TrimSpace(*user.PasswordHash) != "",
		"password_set_at":         user.PasswordSetAt,
		"nickname":                user.Nickname,
		"avatar":                  user.Avatar,
		"telephone":               user.Telephone,
		"create_time":             user.CreatedAt,
		"height":                  user.Height,
		"weight":                  user.Weight,
		"birthday":                user.Birthday,
		"gender":                  user.Gender,
		"activity_level":          user.ActivityLevel,
		"health_condition":        normalizeHealthConditionResponse(user.HealthCondition, storageClient),
		"bmr":                     user.BMR,
		"tdee":                    user.TDEE,
		"onboarding_completed":    onboardingStatus != onboardingStatusPending,
		"onboarding_status":       onboardingStatus,
		"onboarding_draft_step":   user.OnboardingDraftStep,
		"diet_goal":               user.DietGoal,
		"execution_mode":          normalizeExecutionMode(user.ExecutionMode),
		"mode_set_by":             user.ModeSetBy,
		"mode_set_at":             user.ModeSetAt,
		"mode_reason":             user.ModeReason,
		"mode_commitment_days":    user.ModeCommitmentDays,
		"mode_switch_count_30d":   user.ModeSwitchCount30d,
		"searchable":              user.Searchable,
		"public_records":          user.PublicRecords,
		"public_favorite_recipes": user.PublicFavoriteRecipes,
		"motto":                   user.Motto,
	}
}

// FavoriteRecipesVisible reports whether a user's analyzed-food favorites may
// be displayed to other users. A nil value keeps pre-migration users public.
func (s *UserService) FavoriteRecipesVisible(ctx context.Context, userID string) (bool, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, commonerrors.ErrNotFound
	}
	return user.PublicFavoriteRecipes == nil || *user.PublicFavoriteRecipes, nil
}

func buildHealthProfileResponse(user *repo.User) map[string]any {
	return buildHealthProfileResponseWithStorage(user, nil)
}

func (s *UserService) buildHealthProfileResponse(user *repo.User) map[string]any {
	return buildHealthProfileResponseWithStorage(user, s.storage)
}

func buildHealthProfileResponseWithStorage(user *repo.User, storageClient *storage.Client) map[string]any {
	onboardingStatus := resolveOnboardingStatus(user)
	return map[string]any{
		"height":                user.Height,
		"weight":                user.Weight,
		"birthday":              user.Birthday,
		"gender":                user.Gender,
		"activity_level":        user.ActivityLevel,
		"health_condition":      normalizeHealthConditionResponse(user.HealthCondition, storageClient),
		"bmr":                   user.BMR,
		"tdee":                  user.TDEE,
		"onboarding_completed":  onboardingStatus != onboardingStatusPending,
		"onboarding_status":     onboardingStatus,
		"onboarding_draft_step": user.OnboardingDraftStep,
		"diet_goal":             user.DietGoal,
		"execution_mode":        normalizeExecutionMode(user.ExecutionMode),
		"mode_set_by":           user.ModeSetBy,
		"mode_set_at":           user.ModeSetAt,
		"mode_reason":           user.ModeReason,
		"mode_commitment_days":  user.ModeCommitmentDays,
		"mode_switch_count_30d": user.ModeSwitchCount30d,
	}
}

func resolveDailyLifeActivityLevel(user *repo.User, healthCondition map[string]any) string {
	if healthCondition != nil {
		if value, ok := healthCondition["daily_life_activity_level"].(string); ok && strings.TrimSpace(value) != "" {
			return NormalizeDailyLifeActivityLevel(value)
		}
	}
	if user != nil && user.ActivityLevel != nil {
		return NormalizeDailyLifeActivityLevel(*user.ActivityLevel)
	}
	return "sedentary"
}

func derefStringPtr(primary *string, fallback *string) string {
	if primary != nil {
		return strings.TrimSpace(*primary)
	}
	if fallback != nil {
		return strings.TrimSpace(*fallback)
	}
	return ""
}

func hasDashboardTargets(healthCondition map[string]any) bool {
	if healthCondition == nil {
		return false
	}
	raw, ok := healthCondition["dashboard_targets"]
	if !ok || raw == nil {
		return false
	}
	switch targets := raw.(type) {
	case map[string]any:
		return len(targets) > 0
	case map[string]float64:
		return len(targets) > 0
	default:
		return false
	}
}

var dashboardMicroTargetKeys = []string{
	"fiber_target",
	"sugar_target",
	"saturated_fat_target",
	"cholesterol_mg_target",
	"sodium_mg_target",
	"potassium_mg_target",
	"calcium_mg_target",
	"iron_mg_target",
	"magnesium_mg_target",
	"zinc_mg_target",
	"vitamin_a_rae_mcg_target",
	"vitamin_c_mg_target",
	"vitamin_d_mcg_target",
	"vitamin_e_mg_target",
	"vitamin_k_mcg_target",
	"thiamin_mg_target",
	"riboflavin_mg_target",
	"niacin_mg_target",
	"vitamin_b6_mg_target",
	"folate_mcg_target",
	"vitamin_b12_mcg_target",
}

func buildDashboardTargets(user *repo.User) map[string]float64 {
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	dashboardTargets, _ := healthCondition["dashboard_targets"].(map[string]any)
	if dashboardTargets == nil {
		dashboardTargets = dashboardTargetsAsAnyMap(healthCondition["dashboard_targets"])
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

	result := map[string]float64{
		"calorie_target": math.Round(calorieTarget*10) / 10,
		"protein_target": math.Round(protein*10) / 10,
		"carbs_target":   math.Round(carbs*10) / 10,
		"fat_target":     math.Round(fat*10) / 10,
	}
	for _, key := range dashboardMicroTargetKeys {
		if v, ok := dashboardTargets[key]; ok && v != nil {
			if f, ok2 := v.(float64); ok2 {
				result[key] = math.Round(f*10) / 10
			}
		}
	}
	return result
}

func dashboardTargetsAsAnyMap(raw any) map[string]any {
	switch value := raw.(type) {
	case map[string]any:
		return value
	case map[string]float64:
		out := make(map[string]any, len(value))
		for key, val := range value {
			out[key] = val
		}
		return out
	default:
		return map[string]any{}
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

func normalizeHealthConditionResponse(input map[string]any, storageClient *storage.Client) map[string]any {
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
	if report, ok := out["report_extract"].(map[string]any); ok && storageClient != nil {
		if rawURLs, ok := report["_image_urls"]; ok {
			values := stringSliceFromAny(rawURLs)
			if len(values) > 0 {
				signed := make([]string, 0, len(values))
				for _, value := range values {
					if url, err := storageClient.PresignGETURL("health-reports", value, 24*time.Hour); err == nil && strings.TrimSpace(url) != "" {
						signed = append(signed, url)
						continue
					}
					resolved := storageClient.ResolveReferenceURL("health-reports", value)
					if strings.TrimSpace(resolved) != "" {
						signed = append(signed, resolved)
					}
				}
				report["_image_urls"] = signed
				out["report_extract"] = report
			}
		}
	}
	return out
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return cleanStringList(typed)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprintf("%v", item))
			if text != "" && text != "<nil>" {
				out = append(out, text)
			}
		}
		return cleanStringList(out)
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		return []string{text}
	default:
		return nil
	}
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
	if m == standardWebSearchMode || m == fastExecutionMode || m == fastWebSearchMode || m == validExecutionMode || m == strictWebSearchMode || m == experimentalExecutionMode || m == gemini35FlashMode || m == gemini35GroupedMode {
		return m
	}
	return defaultExecutionMode
}
