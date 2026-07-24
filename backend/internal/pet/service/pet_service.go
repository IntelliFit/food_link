package service

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"strings"
	"time"

	membershipdomain "food_link/backend/internal/membership/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/internal/pet/repo"
)

const (
	nextLevelExp            = 100
	maxOfflineCreditDaily   = 1
	petAppearanceRerollCost = 5
)

var (
	petColors        = []string{"mint", "berry", "sunny", "aqua", "grape", "peach", "cream", "matcha"}
	petShapes        = []string{"round", "bean", "puff", "drop"}
	petAccessories   = []string{"leaf", "sprout", "scarf", "drop", "star", "cap", "bow", "halo"}
	petPatterns      = []string{"pattern-0", "pattern-1", "pattern-2", "pattern-3", "pattern-4"}
	petPersonalities = []string{"gentle", "energetic", "focused", "snacky", "sporty"}
	namePrefixes     = []string{"薄荷", "水滴", "米粒", "云朵", "栗子", "柚子", "青团", "奶昔", "豆豆", "星星", "小麦", "松露"}
	nameSuffixes     = []string{"团子", "泡泡", "小勺", "果冻", "饭团", "芽芽", "布丁", "汤圆", "小满", "元气", "可可", "露露"}
)

type PetRepo interface {
	GetPetByUserID(ctx context.Context, userID string) (*petdomain.UserPet, error)
	CreatePet(ctx context.Context, pet *petdomain.UserPet) error
	GetUserProfile(ctx context.Context, userID string) (*repo.UserProfile, error)
	UpdatePet(ctx context.Context, petID string, updates map[string]any) error
	SelectAppearance(ctx context.Context, userID, petID string, updates map[string]any) (*petdomain.UserPet, error)
	AddPetExperience(ctx context.Context, petID string, delta int) (*petdomain.UserPet, error)
	ListFoodRecordsByDate(ctx context.Context, userID, date string) ([]repo.FoodRecord, error)
	GetLatestFoodRecordDate(ctx context.Context, userID string, beforeOrOn string) (string, error)
	SumWaterByDate(ctx context.Context, userID, date string) (int, error)
	SumExerciseByDate(ctx context.Context, userID, date string) (int, error)
	GetDailyScore(ctx context.Context, userID, date string) (*petdomain.UserPetDailyScore, error)
	CreateDailyScore(ctx context.Context, row *petdomain.UserPetDailyScore) (bool, error)
	UpdateDailyScore(ctx context.Context, id string, updates map[string]any) error
	GetEventByUserDateType(ctx context.Context, userID, date, eventType string) (*petdomain.UserPetEvent, error)
	GetLatestUnclaimedEvent(ctx context.Context, userID string) (*petdomain.UserPetEvent, error)
	CreateEvent(ctx context.Context, row *petdomain.UserPetEvent) error
	MarkEventRead(ctx context.Context, eventID string) error
	GetEventByID(ctx context.Context, userID, eventID string) (*petdomain.UserPetEvent, error)
	ClaimEvent(ctx context.Context, userID, eventID string, expReward, creditReward int, relatedDate string, meta map[string]any) (*petdomain.UserPetEvent, *petdomain.UserPet, *membershipdomain.UserEarnedCreditLedger, bool, error)
	RerollAppearance(ctx context.Context, userID, petID string, updates map[string]any, cost int, meta map[string]any) (*petdomain.UserPet, *membershipdomain.UserEarnedCreditLedger, error)
}

type Service struct {
	repo                 PetRepo
	storage              PetAvatarStorage
	pixelAvatarGenerator PixelAvatarGenerator
}

func NewService(repo PetRepo) *Service {
	return &Service{repo: repo}
}

type PetAvatarStorage interface {
	UploadBytes(bucketAlias, key string, data []byte, contentType string) (string, error)
	BuildAccessURL(bucketAlias, key string) string
}

type PixelAvatarGenerator interface {
	GeneratePixelAvatar(ctx context.Context, source []byte) ([]byte, error)
}

func (s *Service) ConfigureStorage(storage PetAvatarStorage) {
	s.storage = storage
}

func (s *Service) ConfigurePixelAvatarGenerator(generator PixelAvatarGenerator) {
	s.pixelAvatarGenerator = generator
}

type Summary struct {
	Pet     PetProfile     `json:"pet"`
	Today   DailyScoreView `json:"today"`
	Status  PetStatus      `json:"status"`
	Event   *EventView     `json:"event,omitempty"`
	Rewards RewardPolicy   `json:"rewards"`
}

type PetProfile struct {
	ID                          string                `json:"id"`
	PetSeed                     string                `json:"pet_seed"`
	Name                        string                `json:"name"`
	Color                       string                `json:"color"`
	Shape                       string                `json:"shape"`
	Pattern                     string                `json:"pattern"`
	Accessory                   string                `json:"accessory"`
	Personality                 string                `json:"personality"`
	Level                       int                   `json:"level"`
	Experience                  int                   `json:"experience"`
	LevelExp                    int                   `json:"level_exp"`
	NextLevelExp                int                   `json:"next_level_exp"`
	LevelProgress               int                   `json:"level_progress"`
	TotalEvents                 int                   `json:"total_events"`
	Archetype                   string                `json:"archetype,omitempty"`
	MatchReasons                []string              `json:"match_reasons,omitempty"`
	NeedsSelection              bool                  `json:"needs_selection"`
	SelectionCandidates         []AppearanceCandidate `json:"selection_candidates,omitempty"`
	FreeProfileRematchAvailable bool                  `json:"free_profile_rematch_available"`
	GrowthUnlocks               []string              `json:"growth_unlocks,omitempty"`
	AvatarType                  string                `json:"avatar_type,omitempty"`
	PixelAvatarURL              string                `json:"pixel_avatar_url,omitempty"`
	PixelAvatarBlinkURL         string                `json:"pixel_avatar_blink_url,omitempty"`
	PixelAvatarSquashURL        string                `json:"pixel_avatar_squash_url,omitempty"`
	PixelAvatarJumpURL          string                `json:"pixel_avatar_jump_url,omitempty"`
}

type DailyScoreView struct {
	Date       string         `json:"date"`
	HabitScore int            `json:"habit_score"`
	ExpGained  int            `json:"exp_gained"`
	Details    map[string]any `json:"details"`
}

type PetStatus struct {
	Mood           string `json:"mood"`
	State          string `json:"state"`
	MealState      string `json:"meal_state"`
	Message        string `json:"message"`
	TaskText       string `json:"task_text"`
	InactivityDays int    `json:"inactivity_days"`
	CanRevive      bool   `json:"can_revive"`
}

type EventView struct {
	ID           string         `json:"id"`
	EventDate    string         `json:"event_date"`
	EventType    string         `json:"event_type"`
	Title        string         `json:"title"`
	Message      string         `json:"message"`
	TaskText     string         `json:"task_text"`
	HabitScore   int            `json:"habit_score"`
	ExpReward    int            `json:"exp_reward"`
	CreditReward int            `json:"credit_reward"`
	CanClaim     bool           `json:"can_claim"`
	IsRead       bool           `json:"is_read"`
	IsClaimed    bool           `json:"is_claimed"`
	Details      map[string]any `json:"details,omitempty"`
}

type RewardPolicy struct {
	DailyCreditCap int `json:"daily_credit_cap"`
}

type ClaimResult struct {
	Pet                  PetProfile `json:"pet"`
	Event                EventView  `json:"event"`
	CreditsAwarded       int        `json:"credits_awarded"`
	ExpAwarded           int        `json:"exp_awarded"`
	EarnedCreditsBalance *int       `json:"earned_credits_balance,omitempty"`
}

type AppearanceRerollResult struct {
	Pet                  PetProfile `json:"pet"`
	CreditsCost          int        `json:"credits_cost"`
	EarnedCreditsBalance *int       `json:"earned_credits_balance,omitempty"`
}

type AppearanceSelectResult struct {
	Pet PetProfile `json:"pet"`
}

func ChinaToday() string {
	return time.Now().In(chinaTZ()).Format("2006-01-02")
}

func (s *Service) Summary(ctx context.Context, userID, date string) (*Summary, error) {
	if strings.TrimSpace(date) == "" {
		date = ChinaToday()
	}
	day, err := parseChinaDate(date)
	if err != nil {
		return nil, err
	}
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	pet, err := s.ensurePet(ctx, userID, profile)
	if err != nil {
		return nil, err
	}
	pet, err = s.ensureProfileMatch(ctx, userID, pet, profile)
	if err != nil {
		return nil, err
	}
	todayScore, createdToday, err := s.ensureDailyScore(ctx, userID, pet, date)
	if err != nil {
		return nil, err
	}
	if createdToday && todayScore.ExpGained > 0 {
		pet, err = s.repo.AddPetExperience(ctx, pet.ID, todayScore.ExpGained)
		if err != nil {
			return nil, err
		}
	}
	if err := s.ensureOfflineEvent(ctx, userID, pet, date); err != nil {
		return nil, err
	}
	if err := s.repo.UpdatePet(ctx, pet.ID, map[string]any{
		"last_summary_at": time.Now(),
		"today_status":    moodForScore(todayScore.HabitScore),
	}); err != nil {
		return nil, err
	}
	pet.TodayStatus = moodForScore(todayScore.HabitScore)
	now := time.Now()
	pet.LastSummaryAt = &now
	eventDate := day.AddDate(0, 0, -1).Format("2006-01-02")
	event, err := s.repo.GetEventByUserDateType(ctx, userID, eventDate, petdomain.EventTypeOfflineReview)
	if err != nil {
		return nil, err
	}
	if event != nil && !event.IsRead {
		_ = s.repo.MarkEventRead(ctx, event.ID)
		event.IsRead = true
	}
	status := s.statusForPet(ctx, userID, pet.Name, date, todayScore.HabitScore, todayScore.ScoreDetails)
	if event != nil && !event.IsClaimed && status.InactivityDays < 2 && !truthy(todayScore.ScoreDetails["recorded_meal"]) {
		status.Message = event.Message
		status.TaskText = event.TaskText
		status.Mood = "surprised"
		status.State = "surprised"
	}
	return &Summary{
		Pet:     s.profileFromPet(pet),
		Today:   dailyScoreView(todayScore),
		Status:  status,
		Event:   eventView(event),
		Rewards: RewardPolicy{DailyCreditCap: maxOfflineCreditDaily},
	}, nil
}

func (s *Service) ClaimEvent(ctx context.Context, userID, eventID string) (*ClaimResult, error) {
	event, err := s.repo.GetEventByID(ctx, userID, eventID)
	if err != nil || event == nil {
		return nil, err
	}
	alreadyClaimed := event.IsClaimed
	eventDate := formatDate(event.EventDate)
	claimedEvent, pet, ledger, appliedCredit, err := s.repo.ClaimEvent(ctx, userID, eventID, event.ExpReward, event.CreditReward, eventDate, map[string]any{
		"event_id":    eventID,
		"event_date":  eventDate,
		"event_type":  event.EventType,
		"habit_score": event.HabitScore,
	})
	if err != nil || claimedEvent == nil || pet == nil {
		return nil, err
	}
	creditsAwarded := 0
	if appliedCredit {
		creditsAwarded = event.CreditReward
	}
	expAwarded := 0
	if !alreadyClaimed {
		expAwarded = event.ExpReward
	}
	result := &ClaimResult{
		Pet:            s.profileFromPet(pet),
		Event:          *eventView(claimedEvent),
		CreditsAwarded: creditsAwarded,
		ExpAwarded:     expAwarded,
	}
	if ledger != nil {
		value := ledger.BalanceAfter
		result.EarnedCreditsBalance = &value
	}
	return result, nil
}

func (s *Service) RerollAppearance(ctx context.Context, userID string) (*AppearanceRerollResult, error) {
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	pet, err := s.ensurePet(ctx, userID, profile)
	if err != nil {
		return nil, err
	}
	match := buildProfileMatch(userID, profile)
	style := []string{"pretty", "quirky", "stable"}[stableHash(fmt.Sprintf("pet:%s:%d:style", userID, time.Now().UnixNano()))%3]
	candidate := candidateFromSeed(fmt.Sprintf("pet:%s:reroll:%d", userID, time.Now().UnixNano()), match.Archetype, style, match.Reasons)
	meta := mergedProfileMeta(pet.Meta, match)
	meta["selected_candidate_id"] = candidate.ID
	meta["last_reroll_at"] = time.Now().Format(time.RFC3339)
	updatedPet, ledger, err := s.repo.RerollAppearance(ctx, userID, pet.ID, map[string]any{
		"pet_seed":    candidate.PetSeed,
		"color":       candidate.Color,
		"shape":       candidate.Shape,
		"pattern":     candidate.Pattern,
		"accessory":   candidate.Accessory,
		"personality": candidate.Personality,
		"meta":        meta,
		"updated_at":  time.Now(),
	}, petAppearanceRerollCost, map[string]any{
		"cost":          petAppearanceRerollCost,
		"pet_id":        pet.ID,
		"old_seed":      pet.PetSeed,
		"new_seed":      candidate.PetSeed,
		"old_color":     pet.Color,
		"new_color":     candidate.Color,
		"old_shape":     pet.Shape,
		"new_shape":     candidate.Shape,
		"old_pattern":   pet.Pattern,
		"new_pattern":   candidate.Pattern,
		"old_accessory": pet.Accessory,
		"new_accessory": candidate.Accessory,
		"archetype":     match.Archetype,
	})
	if err != nil {
		return nil, err
	}
	result := &AppearanceRerollResult{
		Pet:         s.profileFromPet(updatedPet),
		CreditsCost: petAppearanceRerollCost,
	}
	if ledger != nil {
		value := ledger.BalanceAfter
		result.EarnedCreditsBalance = &value
	}
	return result, nil
}

func (s *Service) SelectAppearance(ctx context.Context, userID, candidateID string) (*AppearanceSelectResult, error) {
	candidateID = strings.TrimSpace(candidateID)
	if candidateID == "" {
		return nil, fmt.Errorf("candidate_id required")
	}
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	pet, err := s.ensurePet(ctx, userID, profile)
	if err != nil {
		return nil, err
	}
	pet, err = s.ensureProfileMatch(ctx, userID, pet, profile)
	if err != nil {
		return nil, err
	}
	candidates := candidatesFromMeta(pet.Meta)
	var selected *AppearanceCandidate
	for _, candidate := range candidates {
		if candidate.ID == candidateID {
			c := candidate
			selected = &c
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("candidate not found")
	}
	meta := cloneMeta(pet.Meta)
	meta["selected_candidate_id"] = selected.ID
	meta["free_profile_rematch_used"] = true
	meta["selected_at"] = time.Now().Format(time.RFC3339)
	updatedPet, err := s.repo.SelectAppearance(ctx, userID, pet.ID, map[string]any{
		"pet_seed":    selected.PetSeed,
		"name":        selected.Name,
		"color":       selected.Color,
		"shape":       selected.Shape,
		"pattern":     selected.Pattern,
		"accessory":   selected.Accessory,
		"personality": selected.Personality,
		"meta":        meta,
	})
	if err != nil {
		return nil, err
	}
	if updatedPet == nil {
		return nil, nil
	}
	return &AppearanceSelectResult{Pet: s.profileFromPet(updatedPet)}, nil
}

func IsInsufficientEarnedCreditsError(err error) bool {
	return errors.Is(err, repo.ErrInsufficientEarnedCredits)
}

func (s *Service) ensurePet(ctx context.Context, userID string, profile *repo.UserProfile) (*petdomain.UserPet, error) {
	pet, err := s.repo.GetPetByUserID(ctx, userID)
	if err != nil || pet != nil {
		return pet, err
	}
	match := buildProfileMatch(userID, profile)
	candidate := match.Candidates[0]
	meta := profileMatchMeta(match)
	pet = &petdomain.UserPet{
		UserID:      userID,
		PetSeed:     candidate.PetSeed,
		Name:        candidate.Name,
		Color:       candidate.Color,
		Shape:       candidate.Shape,
		Pattern:     candidate.Pattern,
		Accessory:   candidate.Accessory,
		Personality: candidate.Personality,
		Level:       1,
		Experience:  0,
		TodayStatus: "calm",
		Meta:        meta,
	}
	if err := s.repo.CreatePet(ctx, pet); err != nil {
		return nil, err
	}
	return s.repo.GetPetByUserID(ctx, userID)
}

func (s *Service) ensureProfileMatch(ctx context.Context, userID string, pet *petdomain.UserPet, profile *repo.UserProfile) (*petdomain.UserPet, error) {
	if pet == nil {
		return nil, nil
	}
	match := buildProfileMatch(userID, profile)
	currentVersion := intFromMeta(pet.Meta, "profile_match_version")
	currentFingerprint := stringFromMeta(pet.Meta, "profile_fingerprint")
	selectedID := stringFromMeta(pet.Meta, "selected_candidate_id")
	if currentVersion >= petProfileMatchVersion && currentFingerprint == match.Fingerprint {
		return pet, nil
	}
	meta := mergedProfileMeta(pet.Meta, match)
	if currentVersion == 0 {
		meta["free_profile_rematch_used"] = false
	}
	updates := map[string]any{
		"meta": meta,
	}
	if selectedID == "" || currentVersion == 0 {
		candidate := match.Candidates[0]
		updates["pet_seed"] = candidate.PetSeed
		updates["color"] = candidate.Color
		updates["shape"] = candidate.Shape
		updates["pattern"] = candidate.Pattern
		updates["accessory"] = candidate.Accessory
		updates["personality"] = candidate.Personality
		if strings.TrimSpace(pet.Name) == "" {
			updates["name"] = candidate.Name
		}
	}
	if err := s.repo.UpdatePet(ctx, pet.ID, updates); err != nil {
		return nil, err
	}
	updated, err := s.repo.GetPetByUserID(ctx, userID)
	if err != nil || updated == nil {
		return updated, err
	}
	return updated, nil
}

func (s *Service) ensureDailyScore(ctx context.Context, userID string, pet *petdomain.UserPet, date string) (*petdomain.UserPetDailyScore, bool, error) {
	existing, err := s.repo.GetDailyScore(ctx, userID, date)
	if err != nil {
		return nil, false, err
	}
	score := s.calculateDailyScore(ctx, userID, date)
	if existing != nil {
		if err := s.repo.UpdateDailyScore(ctx, existing.ID, map[string]any{
			"habit_score":   score.HabitScore,
			"score_details": score.Details,
		}); err != nil {
			return nil, false, err
		}
		existing.HabitScore = score.HabitScore
		existing.ScoreDetails = score.Details
		return existing, false, nil
	}
	row := &petdomain.UserPetDailyScore{
		UserID:       userID,
		ScoreDate:    mustParseDate(date),
		HabitScore:   score.HabitScore,
		ExpGained:    score.ExpGained,
		ScoreDetails: score.Details,
	}
	created, err := s.repo.CreateDailyScore(ctx, row)
	if err != nil {
		return nil, false, err
	}
	if !created {
		existing, err = s.repo.GetDailyScore(ctx, userID, date)
		if err != nil {
			return nil, false, err
		}
		if existing != nil {
			return existing, false, nil
		}
	}
	_ = pet
	return row, true, nil
}

func (s *Service) ensureOfflineEvent(ctx context.Context, userID string, pet *petdomain.UserPet, date string) error {
	day, err := parseChinaDate(date)
	if err != nil {
		return err
	}
	eventDate := day.AddDate(0, 0, -1).Format("2006-01-02")
	existing, err := s.repo.GetEventByUserDateType(ctx, userID, eventDate, petdomain.EventTypeOfflineReview)
	if err != nil || existing != nil {
		return err
	}
	score, _, err := s.ensureDailyScore(ctx, userID, pet, eventDate)
	if err != nil {
		return err
	}
	message, task := offlineMessage(pet.Name, score.HabitScore, score.ScoreDetails)
	creditReward := 0
	if score.HabitScore >= 3 {
		creditReward = maxOfflineCreditDaily
	}
	event := &petdomain.UserPetEvent{
		UserID:       userID,
		PetID:        pet.ID,
		EventDate:    mustParseDate(eventDate),
		EventType:    petdomain.EventTypeOfflineReview,
		Title:        "离线小复盘",
		Message:      message,
		TaskText:     task,
		HabitScore:   score.HabitScore,
		ExpReward:    10 + score.HabitScore*3,
		CreditReward: creditReward,
		ScoreDetails: score.ScoreDetails,
	}
	if err := s.repo.CreateEvent(ctx, event); err != nil {
		return err
	}
	return s.repo.UpdatePet(ctx, pet.ID, map[string]any{"last_settled_on": mustParseDate(eventDate)})
}

type calculatedScore struct {
	HabitScore int
	ExpGained  int
	Details    map[string]any
}

func (s *Service) calculateDailyScore(ctx context.Context, userID, date string) calculatedScore {
	records, _ := s.repo.ListFoodRecordsByDate(ctx, userID, date)
	waterMl, _ := s.repo.SumWaterByDate(ctx, userID, date)
	exerciseKcal, _ := s.repo.SumExerciseByDate(ctx, userID, date)
	totalCalories, totalProtein := 0.0, 0.0
	mealTypes := map[string]struct{}{}
	for _, row := range records {
		totalCalories += row.TotalCalories
		totalProtein += row.TotalProtein
		if row.MealType != "" {
			mealTypes[row.MealType] = struct{}{}
		}
	}
	details := map[string]any{
		"record_count":         len(records),
		"meal_count":           len(mealTypes),
		"total_calories":       round1(totalCalories),
		"total_protein":        round1(totalProtein),
		"water_ml":             waterMl,
		"exercise_kcal":        exerciseKcal,
		"calorie_target_hint":  2200,
		"protein_target_hint":  60,
		"water_target_hint_ml": 1500,
	}
	score := 0
	if len(records) > 0 {
		score++
		details["recorded_meal"] = true
	}
	if totalCalories > 0 && totalCalories <= 2200 {
		score++
		details["calorie_stable"] = true
	}
	if totalProtein >= 60 {
		score++
		details["protein_good"] = true
	}
	if waterMl >= 1500 {
		score++
		details["water_good"] = true
	}
	if len(mealTypes) >= 3 {
		score++
		details["three_meals"] = true
	}
	if exerciseKcal > 0 {
		score++
		details["exercise_logged"] = true
	}
	exp := score * 10
	if score == 0 && len(records) > 0 {
		exp = 5
	}
	return calculatedScore{HabitScore: score, ExpGained: exp, Details: details}
}

type petAppearance struct {
	Name        string
	Color       string
	Shape       string
	Pattern     string
	Accessory   string
	Personality string
}

func appearanceFromSeed(seed string) petAppearance {
	nameHash := stableHash(seed + ":name")
	return petAppearance{
		Name:        namePrefixes[nameHash%uint32(len(namePrefixes))] + nameSuffixes[(nameHash/uint32(len(namePrefixes)))%uint32(len(nameSuffixes))],
		Color:       pick(seed+":color", petColors),
		Shape:       pick(seed+":shape", petShapes),
		Pattern:     pick(seed+":pattern", petPatterns),
		Accessory:   pick(seed+":accessory", petAccessories),
		Personality: pick(seed+":personality", petPersonalities),
	}
}

func pick(seed string, values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[stableHash(seed)%uint32(len(values))]
}

func stableHash(value string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return h.Sum32()
}

func profileMatchMeta(match profileMatch) map[string]any {
	return map[string]any{
		"profile_match_version":     match.Version,
		"profile_fingerprint":       match.Fingerprint,
		"archetype":                 match.Archetype,
		"match_reasons":             match.Reasons,
		"selection_candidates":      match.Candidates,
		"selected_candidate_id":     "",
		"free_profile_rematch_used": false,
		"profile_matched_at":        time.Now().Format(time.RFC3339),
	}
}

func mergedProfileMeta(existing map[string]any, match profileMatch) map[string]any {
	meta := cloneMeta(existing)
	meta["profile_match_version"] = match.Version
	meta["profile_fingerprint"] = match.Fingerprint
	meta["archetype"] = match.Archetype
	meta["match_reasons"] = match.Reasons
	meta["selection_candidates"] = match.Candidates
	meta["profile_matched_at"] = time.Now().Format(time.RFC3339)
	if _, ok := meta["free_profile_rematch_used"]; !ok {
		meta["free_profile_rematch_used"] = false
	}
	if _, ok := meta["selected_candidate_id"]; !ok {
		meta["selected_candidate_id"] = ""
	}
	return meta
}

func cloneMeta(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

func candidatesFromMeta(meta map[string]any) []AppearanceCandidate {
	if len(meta) == 0 {
		return nil
	}
	switch rows := meta["selection_candidates"].(type) {
	case []AppearanceCandidate:
		return rows
	case []any:
		candidates := make([]AppearanceCandidate, 0, len(rows))
		for _, row := range rows {
			if candidate, ok := appearanceCandidateFromAny(row); ok {
				candidates = append(candidates, candidate)
			}
		}
		return candidates
	default:
		return nil
	}
}

func appearanceCandidateFromAny(value any) (AppearanceCandidate, bool) {
	row, ok := value.(map[string]any)
	if !ok {
		return AppearanceCandidate{}, false
	}
	return AppearanceCandidate{
		ID:           stringFromMap(row, "id"),
		PetSeed:      stringFromMap(row, "pet_seed"),
		Name:         stringFromMap(row, "name"),
		Color:        stringFromMap(row, "color"),
		Shape:        stringFromMap(row, "shape"),
		Pattern:      stringFromMap(row, "pattern"),
		Accessory:    stringFromMap(row, "accessory"),
		Personality:  stringFromMap(row, "personality"),
		Archetype:    stringFromMap(row, "archetype"),
		Style:        stringFromMap(row, "style"),
		Score:        intFromAny(row["score"]),
		MatchReasons: stringSliceFromAny(row["match_reasons"]),
	}, true
}

func stringFromMap(row map[string]any, key string) string {
	if row == nil {
		return ""
	}
	if value, ok := row[key].(string); ok {
		return value
	}
	return ""
}

func stringFromMeta(meta map[string]any, key string) string {
	if len(meta) == 0 {
		return ""
	}
	if value, ok := meta[key].(string); ok {
		return value
	}
	return ""
}

func intFromMeta(meta map[string]any, key string) int {
	if len(meta) == 0 {
		return 0
	}
	return intFromAny(meta[key])
}

func intFromAny(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	default:
		return 0
	}
}

func boolFromMeta(meta map[string]any, key string) bool {
	if len(meta) == 0 {
		return false
	}
	value, ok := meta[key].(bool)
	return ok && value
}

func stringSliceFromAny(value any) []string {
	switch rows := value.(type) {
	case []string:
		return rows
	case []any:
		items := make([]string, 0, len(rows))
		for _, row := range rows {
			if text := strings.TrimSpace(fmt.Sprint(row)); text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return nil
	}
}

func (s *Service) profileFromPet(pet *petdomain.UserPet) PetProfile {
	if pet == nil {
		return PetProfile{}
	}
	levelExp := pet.Experience % nextLevelExp
	candidates := candidatesFromMeta(pet.Meta)
	selectedID := stringFromMeta(pet.Meta, "selected_candidate_id")
	pixelAvatarKey := stringFromMeta(pet.Meta, "pixel_avatar_key")
	pixelAvatarBlinkKey := stringFromMeta(pet.Meta, "pixel_avatar_blink_key")
	pixelAvatarSquashKey := stringFromMeta(pet.Meta, "pixel_avatar_squash_key")
	pixelAvatarJumpKey := stringFromMeta(pet.Meta, "pixel_avatar_jump_key")
	pixelAvatarURL := ""
	pixelAvatarBlinkURL := ""
	pixelAvatarSquashURL := ""
	pixelAvatarJumpURL := ""
	if pixelAvatarKey != "" && s.storage != nil {
		pixelAvatarURL = s.storage.BuildAccessURL("user-avatars", pixelAvatarKey)
		if pixelAvatarBlinkKey != "" {
			pixelAvatarBlinkURL = s.storage.BuildAccessURL("user-avatars", pixelAvatarBlinkKey)
		}
		if pixelAvatarSquashKey != "" {
			pixelAvatarSquashURL = s.storage.BuildAccessURL("user-avatars", pixelAvatarSquashKey)
		}
		if pixelAvatarJumpKey != "" {
			pixelAvatarJumpURL = s.storage.BuildAccessURL("user-avatars", pixelAvatarJumpKey)
		}
	}
	return PetProfile{
		ID:                          pet.ID,
		PetSeed:                     pet.PetSeed,
		Name:                        pet.Name,
		Color:                       pet.Color,
		Shape:                       pet.Shape,
		Pattern:                     pet.Pattern,
		Accessory:                   pet.Accessory,
		Personality:                 pet.Personality,
		Level:                       pet.Level,
		Experience:                  pet.Experience,
		LevelExp:                    levelExp,
		NextLevelExp:                nextLevelExp,
		LevelProgress:               int(math.Round(float64(levelExp) / float64(nextLevelExp) * 100)),
		TotalEvents:                 pet.TotalEvents,
		Archetype:                   stringFromMeta(pet.Meta, "archetype"),
		MatchReasons:                stringSliceFromAny(pet.Meta["match_reasons"]),
		NeedsSelection:              selectedID == "" && len(candidates) > 0,
		SelectionCandidates:         candidates,
		FreeProfileRematchAvailable: !boolFromMeta(pet.Meta, "free_profile_rematch_used") && len(candidates) > 0,
		GrowthUnlocks:               growthUnlocksForLevel(pet.Level),
		AvatarType:                  stringFromMeta(pet.Meta, "avatar_type"),
		PixelAvatarURL:              pixelAvatarURL,
		PixelAvatarBlinkURL:         pixelAvatarBlinkURL,
		PixelAvatarSquashURL:        pixelAvatarSquashURL,
		PixelAvatarJumpURL:          pixelAvatarJumpURL,
	}
}

func growthUnlocksForLevel(level int) []string {
	unlocks := []string{"Lv.1 默认形象"}
	if level >= 3 {
		unlocks = append(unlocks, "Lv.3 更多状态文案")
	}
	if level >= 5 {
		unlocks = append(unlocks, "Lv.5 配饰候选权重提升")
	}
	if level >= 8 {
		unlocks = append(unlocks, "Lv.8 动作与表情文案池")
	}
	return unlocks
}

func dailyScoreView(row *petdomain.UserPetDailyScore) DailyScoreView {
	if row == nil {
		return DailyScoreView{Details: map[string]any{}}
	}
	return DailyScoreView{
		Date:       formatDate(row.ScoreDate),
		HabitScore: row.HabitScore,
		ExpGained:  row.ExpGained,
		Details:    row.ScoreDetails,
	}
}

func eventView(row *petdomain.UserPetEvent) *EventView {
	if row == nil {
		return nil
	}
	return &EventView{
		ID:           row.ID,
		EventDate:    formatDate(row.EventDate),
		EventType:    row.EventType,
		Title:        row.Title,
		Message:      row.Message,
		TaskText:     row.TaskText,
		HabitScore:   row.HabitScore,
		ExpReward:    row.ExpReward,
		CreditReward: row.CreditReward,
		CanClaim:     !row.IsClaimed && (row.ExpReward > 0 || row.CreditReward > 0),
		IsRead:       row.IsRead,
		IsClaimed:    row.IsClaimed,
		Details:      row.ScoreDetails,
	}
}

func statusForScore(name string, score int, details map[string]any) PetStatus {
	task := nextTask(details)
	switch {
	case score >= 5:
		return PetStatus{Mood: "happy", State: "active", Message: fmt.Sprintf("%s今天满电了，好习惯正在发光。", name), TaskText: task}
	case score >= 3:
		return PetStatus{Mood: "calm", State: "steady", Message: fmt.Sprintf("%s整理完今天的记录，状态稳稳的。", name), TaskText: task}
	case score >= 1:
		return PetStatus{Mood: "calm", State: "warming", Message: fmt.Sprintf("%s睁眼啦，正在慢慢回到状态。", name), TaskText: task}
	default:
		return PetStatus{Mood: "sleepy", State: "sleepy", Message: fmt.Sprintf("%s还在等第一条记录，先从一餐开始吧。", name), TaskText: task}
	}
}

func (s *Service) statusForPet(ctx context.Context, userID, name, date string, score int, details map[string]any) PetStatus {
	status := statusForScore(name, score, details)
	status.MealState = mealStateFromDetails(details)
	inactivityDays := s.inactivityDays(ctx, userID, date, details)
	status.InactivityDays = inactivityDays
	if truthy(details["recorded_meal"]) {
		status.CanRevive = inactivityDays > 0
		return status
	}
	if inactivityDays >= 14 {
		status.Mood = "sleepy"
		status.State = "deep_sleep"
		status.Message = fmt.Sprintf("%s躲进保温箱深睡了，但不会饿死。记录一餐就能把它叫醒。", name)
		status.TaskText = "记录一餐，把它从保温箱叫出来"
		return status
	}
	if inactivityDays >= 7 {
		status.Mood = "sleepy"
		status.State = "hibernating"
		status.Message = fmt.Sprintf("%s缩成小团子冬眠中，正在给你留灯。", name)
		status.TaskText = "记录一餐，唤醒冬眠小团子"
		return status
	}
	if inactivityDays >= 4 {
		status.Mood = "sleepy"
		status.State = "low_power"
		status.Message = fmt.Sprintf("%s进入低电量模式了，眼睛快睁不开。", name)
		status.TaskText = "记录一餐，给它充一点电"
		return status
	}
	if inactivityDays >= 2 {
		status.Mood = "sleepy"
		status.State = "dozing"
		status.Message = fmt.Sprintf("%s有点犯困，正在等你回来记录。", name)
		status.TaskText = "记录一餐，让它睁开眼"
		return status
	}
	return status
}

func mealStateFromDetails(details map[string]any) string {
	if truthy(details["three_meals"]) {
		return "satisfied"
	}
	if truthy(details["recorded_meal"]) {
		return "fed"
	}
	return "hungry"
}

func (s *Service) inactivityDays(ctx context.Context, userID, date string, details map[string]any) int {
	if truthy(details["recorded_meal"]) {
		return 0
	}
	target, err := parseChinaDate(date)
	if err != nil {
		return 0
	}
	latest, err := s.repo.GetLatestFoodRecordDate(ctx, userID, date)
	if err != nil || strings.TrimSpace(latest) == "" {
		return 0
	}
	latestDate, err := parseChinaDate(latest)
	if err != nil {
		return 0
	}
	days := int(target.Sub(latestDate).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

func moodForScore(score int) string {
	if score >= 5 {
		return "happy"
	}
	if score == 0 {
		return "sleepy"
	}
	return "calm"
}

func nextTask(details map[string]any) string {
	if details == nil {
		return "记录一餐，唤醒今日成长"
	}
	if truthy(details["recorded_meal"]) == false {
		return "记录一餐，唤醒今日成长"
	}
	if truthy(details["protein_good"]) == false {
		return "补一点优质蛋白"
	}
	if truthy(details["water_good"]) == false {
		return "喝水进度再推一格"
	}
	if truthy(details["three_meals"]) == false {
		return "把三餐记录补完整"
	}
	if truthy(details["exercise_logged"]) == false {
		return "记录一次运动或散步"
	}
	return "今天状态不错，保持节奏"
}

func offlineMessage(name string, score int, details map[string]any) (string, string) {
	good := bestHabit(details)
	if score >= 3 {
		return fmt.Sprintf("你不在的时候，%s整理了昨天的记录，发现%s，带回 1 积分。", name, good), nextTask(details)
	}
	if score > 0 {
		return fmt.Sprintf("你不在的时候，%s看了看昨天的记录，准备了一点成长能量。", name), nextTask(details)
	}
	return fmt.Sprintf("你不在的时候，%s把小窝收拾好了，等你今天一起记录第一餐。", name), "今天先记录一餐"
}

func bestHabit(details map[string]any) string {
	candidates := []struct {
		key  string
		text string
	}{
		{"protein_good", "蛋白质完成得不错"},
		{"water_good", "喝水节奏很好"},
		{"calorie_stable", "热量控制得很稳"},
		{"three_meals", "三餐记录很完整"},
		{"exercise_logged", "运动也有记录"},
	}
	for _, item := range candidates {
		if truthy(details[item.key]) {
			return item.text
		}
	}
	return "你有认真记录饮食"
}

func truthy(value any) bool {
	v, ok := value.(bool)
	return ok && v
}

func parseChinaDate(date string) (time.Time, error) {
	return time.Parse("2006-01-02", date)
}

func mustParseDate(date string) time.Time {
	day, err := parseChinaDate(date)
	if err != nil {
		return time.Time{}
	}
	return day
}

func formatDate(day time.Time) string {
	if day.IsZero() {
		return ""
	}
	return day.In(chinaTZ()).Format("2006-01-02")
}

func chinaTZ() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
