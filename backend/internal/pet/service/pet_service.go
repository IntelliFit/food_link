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
	nextLevelExp          = 100
	maxOfflineCreditDaily = 1
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
	UpdatePet(ctx context.Context, petID string, updates map[string]any) error
	AddPetExperience(ctx context.Context, petID string, delta int) (*petdomain.UserPet, error)
	ListFoodRecordsByDate(ctx context.Context, userID, date string) ([]repo.FoodRecord, error)
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
	repo PetRepo
}

func NewService(repo PetRepo) *Service {
	return &Service{repo: repo}
}

type Summary struct {
	Pet     PetProfile     `json:"pet"`
	Today   DailyScoreView `json:"today"`
	Status  PetStatus      `json:"status"`
	Event   *EventView     `json:"event,omitempty"`
	Rewards RewardPolicy   `json:"rewards"`
}

type PetProfile struct {
	ID            string `json:"id"`
	PetSeed       string `json:"pet_seed"`
	Name          string `json:"name"`
	Color         string `json:"color"`
	Shape         string `json:"shape"`
	Pattern       string `json:"pattern"`
	Accessory     string `json:"accessory"`
	Personality   string `json:"personality"`
	Level         int    `json:"level"`
	Experience    int    `json:"experience"`
	LevelExp      int    `json:"level_exp"`
	NextLevelExp  int    `json:"next_level_exp"`
	LevelProgress int    `json:"level_progress"`
	TotalEvents   int    `json:"total_events"`
}

type DailyScoreView struct {
	Date       string         `json:"date"`
	HabitScore int            `json:"habit_score"`
	ExpGained  int            `json:"exp_gained"`
	Details    map[string]any `json:"details"`
}

type PetStatus struct {
	Mood     string `json:"mood"`
	Message  string `json:"message"`
	TaskText string `json:"task_text"`
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

func ChinaToday() string {
	return time.Now().In(chinaTZ()).Format("2006-01-02")
}

func (s *Service) Summary(ctx context.Context, userID, date string) (*Summary, error) {
	if strings.TrimSpace(date) == "" {
		date = ChinaToday()
	}
	if _, err := parseChinaDate(date); err != nil {
		return nil, err
	}
	pet, err := s.ensurePet(ctx, userID)
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
	event, err := s.repo.GetLatestUnclaimedEvent(ctx, userID)
	if err != nil {
		return nil, err
	}
	if event != nil && !event.IsRead {
		_ = s.repo.MarkEventRead(ctx, event.ID)
		event.IsRead = true
	}
	status := statusForScore(pet.Name, todayScore.HabitScore, todayScore.ScoreDetails)
	if event != nil && !event.IsClaimed {
		status.Message = event.Message
		status.TaskText = event.TaskText
		status.Mood = "surprised"
	}
	return &Summary{
		Pet:     profileFromPet(pet),
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
		Pet:            profileFromPet(pet),
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
	pet, err := s.ensurePet(ctx, userID)
	if err != nil {
		return nil, err
	}
	newSeed := fmt.Sprintf("pet:%s:%d", userID, time.Now().UnixNano())
	appearance := appearanceFromSeed(newSeed)
	updatedPet, ledger, err := s.repo.RerollAppearance(ctx, userID, pet.ID, map[string]any{
		"pet_seed":   newSeed,
		"color":      appearance.Color,
		"shape":      appearance.Shape,
		"pattern":    appearance.Pattern,
		"accessory":  appearance.Accessory,
		"updated_at": time.Now(),
	}, petAppearanceRerollCost, map[string]any{
		"cost":       petAppearanceRerollCost,
		"pet_id":     pet.ID,
		"old_seed":   pet.PetSeed,
		"new_seed":   newSeed,
		"old_color":  pet.Color,
		"new_color":  appearance.Color,
		"old_shape":  pet.Shape,
		"new_shape":  appearance.Shape,
		"old_pattern": pet.Pattern,
		"new_pattern": appearance.Pattern,
		"old_accessory": pet.Accessory,
		"new_accessory": appearance.Accessory,
	})
	if err != nil {
		return nil, err
	}
	result := &AppearanceRerollResult{
		Pet:         profileFromPet(updatedPet),
		CreditsCost: petAppearanceRerollCost,
	}
	if ledger != nil {
		value := ledger.BalanceAfter
		result.EarnedCreditsBalance = &value
	}
	return result, nil
}

func IsInsufficientEarnedCreditsError(err error) bool {
	return errors.Is(err, repo.ErrInsufficientEarnedCredits)
}

func (s *Service) ensurePet(ctx context.Context, userID string) (*petdomain.UserPet, error) {
	pet, err := s.repo.GetPetByUserID(ctx, userID)
	if err != nil || pet != nil {
		return pet, err
	}
	seed := "pet:" + userID
	appearance := appearanceFromSeed(seed)
	pet = &petdomain.UserPet{
		UserID:      userID,
		PetSeed:     seed,
		Name:        appearance.Name,
		Color:       appearance.Color,
		Shape:       appearance.Shape,
		Pattern:     appearance.Pattern,
		Accessory:   appearance.Accessory,
		Personality: appearance.Personality,
		Level:       1,
		Experience:  0,
		TodayStatus: "calm",
	}
	if err := s.repo.CreatePet(ctx, pet); err != nil {
		return nil, err
	}
	return s.repo.GetPetByUserID(ctx, userID)
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

func profileFromPet(pet *petdomain.UserPet) PetProfile {
	if pet == nil {
		return PetProfile{}
	}
	levelExp := pet.Experience % nextLevelExp
	return PetProfile{
		ID:            pet.ID,
		PetSeed:       pet.PetSeed,
		Name:          pet.Name,
		Color:         pet.Color,
		Shape:         pet.Shape,
		Pattern:       pet.Pattern,
		Accessory:     pet.Accessory,
		Personality:   pet.Personality,
		Level:         pet.Level,
		Experience:    pet.Experience,
		LevelExp:      levelExp,
		NextLevelExp:  nextLevelExp,
		LevelProgress: int(math.Round(float64(levelExp) / float64(nextLevelExp) * 100)),
		TotalEvents:   pet.TotalEvents,
	}
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
		return PetStatus{Mood: "happy", Message: fmt.Sprintf("%s今天满电了，好习惯正在发光。", name), TaskText: task}
	case score >= 3:
		return PetStatus{Mood: "calm", Message: fmt.Sprintf("%s整理完今天的记录，状态稳稳的。", name), TaskText: task}
	case score >= 1:
		return PetStatus{Mood: "calm", Message: fmt.Sprintf("%s陪你补一点小习惯，今天还能更舒服。", name), TaskText: task}
	default:
		return PetStatus{Mood: "sleepy", Message: fmt.Sprintf("%s还在等第一条记录，先从一餐开始吧。", name), TaskText: task}
	}
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
	return time.ParseInLocation("2006-01-02", date, chinaTZ())
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
