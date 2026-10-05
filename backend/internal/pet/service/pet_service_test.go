package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	healthdomain "food_link/backend/internal/health/domain"
	membershipdomain "food_link/backend/internal/membership/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/internal/pet/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePetRepo struct {
	pet                  *petdomain.UserPet
	profile              *repo.UserProfile
	dailyScores          map[string]*petdomain.UserPetDailyScore
	events               map[string]*petdomain.UserPetEvent
	foodByDate           map[string][]repo.FoodRecord
	waterByDate          map[string]int
	exerciseByDate       map[string]int
	createPetCalls       int
	createEventCalls     int
	balance              int
	nextID               int
	profileUpgradeCalls  int
	beforeProfileUpgrade func(*fakePetRepo)
}

type fakeFoodWaterProvider struct {
	logs      []healthdomain.BodyWaterLog
	err       error
	callCount int
	startDate string
	endDate   string
}

func (f *fakeFoodWaterProvider) ListDerivedFoodWaterLogs(_ context.Context, _, startDate, endDate string) ([]healthdomain.BodyWaterLog, error) {
	f.callCount++
	f.startDate = startDate
	f.endDate = endDate
	return f.logs, f.err
}

func newFakePetRepo() *fakePetRepo {
	return &fakePetRepo{
		dailyScores:    map[string]*petdomain.UserPetDailyScore{},
		events:         map[string]*petdomain.UserPetEvent{},
		foodByDate:     map[string][]repo.FoodRecord{},
		waterByDate:    map[string]int{},
		exerciseByDate: map[string]int{},
	}
}

func TestParseChinaDateUsesUTCDateOnly(t *testing.T) {
	day, err := parseChinaDate("2026-06-17")
	require.NoError(t, err)
	assert.Equal(t, time.UTC, day.Location())
	assert.Equal(t, "2026-06-17", day.Format("2006-01-02"))
}

func (f *fakePetRepo) id(prefix string) string {
	f.nextID++
	return prefix + "-id"
}

func (f *fakePetRepo) GetPetByUserID(ctx context.Context, userID string) (*petdomain.UserPet, error) {
	if f.pet == nil || f.pet.UserID != userID {
		return nil, nil
	}
	copy := *f.pet
	return &copy, nil
}

func (f *fakePetRepo) CreatePet(ctx context.Context, pet *petdomain.UserPet) error {
	f.createPetCalls++
	if f.pet != nil {
		return nil
	}
	copy := *pet
	copy.ID = f.id("pet")
	f.pet = &copy
	return nil
}

func (f *fakePetRepo) GetUserProfile(ctx context.Context, userID string) (*repo.UserProfile, error) {
	if f.profile == nil {
		return nil, nil
	}
	copy := *f.profile
	return &copy, nil
}

func (f *fakePetRepo) UpdatePet(ctx context.Context, petID string, updates map[string]any) error {
	if f.pet == nil || f.pet.ID != petID {
		return errors.New("pet not found")
	}
	if v, ok := updates["last_settled_on"].(time.Time); ok {
		f.pet.LastSettledOn = &v
	}
	if v, ok := updates["today_status"].(string); ok {
		f.pet.TodayStatus = v
	}
	if v, ok := updates["pet_seed"].(string); ok {
		f.pet.PetSeed = v
	}
	if v, ok := updates["name"].(string); ok {
		f.pet.Name = v
	}
	if v, ok := updates["color"].(string); ok {
		f.pet.Color = v
	}
	if v, ok := updates["shape"].(string); ok {
		f.pet.Shape = v
	}
	if v, ok := updates["pattern"].(string); ok {
		f.pet.Pattern = v
	}
	if v, ok := updates["accessory"].(string); ok {
		f.pet.Accessory = v
	}
	if v, ok := updates["personality"].(string); ok {
		f.pet.Personality = v
	}
	if v, ok := updates["meta"].(map[string]any); ok {
		f.pet.Meta = v
	}
	return nil
}

func (f *fakePetRepo) SelectAppearance(ctx context.Context, userID, petID string, updates map[string]any) (*petdomain.UserPet, error) {
	if f.pet == nil || f.pet.ID != petID || f.pet.UserID != userID {
		return nil, errors.New("pet not found")
	}
	if err := f.UpdatePet(ctx, petID, updates); err != nil {
		return nil, err
	}
	copy := *f.pet
	return &copy, nil
}

func (f *fakePetRepo) UpdatePetIfMetaUnchanged(ctx context.Context, userID, petID string, expectedMeta map[string]any, updates map[string]any) (bool, error) {
	f.profileUpgradeCalls++
	if f.beforeProfileUpgrade != nil {
		hook := f.beforeProfileUpgrade
		f.beforeProfileUpgrade = nil
		hook(f)
	}
	if f.pet == nil || f.pet.UserID != userID || f.pet.ID != petID || !reflect.DeepEqual(f.pet.Meta, expectedMeta) {
		return false, nil
	}
	return true, f.UpdatePet(ctx, petID, updates)
}

func (f *fakePetRepo) AddPetExperience(ctx context.Context, petID string, delta int) (*petdomain.UserPet, error) {
	f.pet.Experience += delta
	f.pet.Level = repo.LevelForExperience(f.pet.Experience)
	copy := *f.pet
	return &copy, nil
}

func (f *fakePetRepo) ListFoodRecordsByDate(ctx context.Context, userID, date string) ([]repo.FoodRecord, error) {
	return f.foodByDate[date], nil
}

func (f *fakePetRepo) ListRecentFoodRecords(ctx context.Context, userID string, start, end time.Time) ([]repo.FoodRecord, error) {
	rows := make([]repo.FoodRecord, 0)
	for _, records := range f.foodByDate {
		for _, record := range records {
			if record.RecordTime == nil || record.RecordTime.Before(start) || !record.RecordTime.Before(end) {
				continue
			}
			rows = append(rows, record)
		}
	}
	return rows, nil
}

func (f *fakePetRepo) GetLatestFoodRecordDate(ctx context.Context, userID string, beforeOrOn string) (string, error) {
	target, err := parseChinaDate(beforeOrOn)
	if err != nil {
		return "", err
	}
	latest := ""
	for date, rows := range f.foodByDate {
		if len(rows) == 0 {
			continue
		}
		day, err := parseChinaDate(date)
		if err != nil {
			continue
		}
		if day.After(target) {
			continue
		}
		if latest == "" || date > latest {
			latest = date
		}
	}
	return latest, nil
}

func (f *fakePetRepo) SumEditableWaterByDate(ctx context.Context, userID, date string) (int, error) {
	return f.waterByDate[date], nil
}

func (f *fakePetRepo) SumExerciseByDate(ctx context.Context, userID, date string) (int, error) {
	return f.exerciseByDate[date], nil
}

func (f *fakePetRepo) GetDailyScore(ctx context.Context, userID, date string) (*petdomain.UserPetDailyScore, error) {
	if row := f.dailyScores[date]; row != nil {
		copy := *row
		return &copy, nil
	}
	return nil, nil
}

func (f *fakePetRepo) CreateDailyScore(ctx context.Context, row *petdomain.UserPetDailyScore) (bool, error) {
	if f.dailyScores[formatDate(row.ScoreDate)] != nil {
		return false, nil
	}
	copy := *row
	copy.ID = f.id("score")
	f.dailyScores[formatDate(row.ScoreDate)] = &copy
	return true, nil
}

func (f *fakePetRepo) UpdateDailyScore(ctx context.Context, id string, updates map[string]any) error {
	for _, row := range f.dailyScores {
		if row.ID == id {
			if v, ok := updates["habit_score"].(int); ok {
				row.HabitScore = v
			}
			if v, ok := updates["score_details"].(map[string]any); ok {
				row.ScoreDetails = v
			}
		}
	}
	return nil
}

func (f *fakePetRepo) GetEventByUserDateType(ctx context.Context, userID, date, eventType string) (*petdomain.UserPetEvent, error) {
	for _, event := range f.events {
		if event.UserID == userID && formatDate(event.EventDate) == date && event.EventType == eventType {
			copy := *event
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakePetRepo) GetLatestUnclaimedEvent(ctx context.Context, userID string) (*petdomain.UserPetEvent, error) {
	for _, event := range f.events {
		if event.UserID == userID && !event.IsClaimed {
			copy := *event
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakePetRepo) CreateEvent(ctx context.Context, row *petdomain.UserPetEvent) error {
	if existing, _ := f.GetEventByUserDateType(ctx, row.UserID, formatDate(row.EventDate), row.EventType); existing != nil {
		return nil
	}
	f.createEventCalls++
	copy := *row
	copy.ID = f.id("event")
	f.events[copy.ID] = &copy
	return nil
}

func (f *fakePetRepo) MarkEventRead(ctx context.Context, eventID string) error {
	if row := f.events[eventID]; row != nil {
		row.IsRead = true
	}
	return nil
}

func (f *fakePetRepo) GetEventByID(ctx context.Context, userID, eventID string) (*petdomain.UserPetEvent, error) {
	row := f.events[eventID]
	if row == nil || row.UserID != userID {
		return nil, nil
	}
	copy := *row
	return &copy, nil
}

func (f *fakePetRepo) ClaimEvent(ctx context.Context, userID, eventID string, expReward, creditReward int, relatedDate string, meta map[string]any) (*petdomain.UserPetEvent, *petdomain.UserPet, *membershipdomain.UserEarnedCreditLedger, bool, error) {
	event := f.events[eventID]
	if event == nil || event.UserID != userID {
		return nil, nil, nil, false, nil
	}
	applied := false
	var ledger *membershipdomain.UserEarnedCreditLedger
	if !event.IsClaimed {
		event.IsClaimed = true
		event.IsRead = true
		f.pet.Experience += expReward
		f.pet.Level = repo.LevelForExperience(f.pet.Experience)
		f.pet.TotalEvents++
		if creditReward > 0 {
			f.balance += creditReward
			applied = true
			ledger = &membershipdomain.UserEarnedCreditLedger{BalanceAfter: f.balance}
		}
	}
	eventCopy := *event
	petCopy := *f.pet
	return &eventCopy, &petCopy, ledger, applied, nil
}

func (f *fakePetRepo) RerollAppearance(ctx context.Context, userID, petID string, updates map[string]any, cost int, meta map[string]any) (*petdomain.UserPet, *membershipdomain.UserEarnedCreditLedger, error) {
	if f.pet == nil || f.pet.ID != petID || f.pet.UserID != userID {
		return nil, nil, errors.New("pet not found")
	}
	if f.balance < cost {
		return nil, nil, repo.ErrInsufficientEarnedCredits
	}
	f.balance -= cost
	if v, ok := updates["pet_seed"].(string); ok {
		f.pet.PetSeed = v
	}
	if v, ok := updates["color"].(string); ok {
		f.pet.Color = v
	}
	if v, ok := updates["shape"].(string); ok {
		f.pet.Shape = v
	}
	if v, ok := updates["pattern"].(string); ok {
		f.pet.Pattern = v
	}
	if v, ok := updates["accessory"].(string); ok {
		f.pet.Accessory = v
	}
	if v, ok := updates["personality"].(string); ok {
		f.pet.Personality = v
	}
	if v, ok := updates["meta"].(map[string]any); ok {
		f.pet.Meta = v
	}
	copy := *f.pet
	ledger := &membershipdomain.UserEarnedCreditLedger{BalanceAfter: f.balance}
	return &copy, ledger, nil
}

func TestSummaryCreatesStablePetAndSingleOfflineEvent(t *testing.T) {
	fake := newFakePetRepo()
	goal := "fat_loss"
	fake.profile = &repo.UserProfile{
		ID:       "user-1",
		DietGoal: &goal,
		HealthCondition: map[string]any{
			"daily_life_activity_level": "moderate",
		},
	}
	fake.foodByDate["2026-05-19"] = []repo.FoodRecord{
		{MealType: "breakfast", TotalCalories: 500, TotalProtein: 30},
		{MealType: "lunch", TotalCalories: 700, TotalProtein: 35},
		{MealType: "dinner", TotalCalories: 600, TotalProtein: 25},
	}
	fake.waterByDate["2026-05-19"] = 1800
	fake.exerciseByDate["2026-05-19"] = 120
	svc := NewService(fake)

	first, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	require.NotNil(t, first.Event)
	assert.Equal(t, 1, fake.createPetCalls)
	assert.Equal(t, 1, fake.createEventCalls)
	assert.Equal(t, 1, first.Event.CreditReward)
	assert.Equal(t, archetypeLightLifestyle, first.Pet.Archetype)
	assert.False(t, first.Pet.NeedsSelection)
	assert.Equal(t, builtinAvatarType, first.Pet.AvatarType)
	assert.Equal(t, builtinAvatarJianwen01ID, first.Pet.BuiltinAvatarID)
	require.Len(t, first.Pet.SelectionCandidates, 5)
	for _, candidate := range first.Pet.SelectionCandidates {
		assert.NotEmpty(t, candidate.BuiltinAvatarID)
	}
	assert.NotEmpty(t, first.Pet.MatchReasons)

	second, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, first.Pet.ID, second.Pet.ID)
	assert.Equal(t, 1, fake.createPetCalls)
	assert.Equal(t, 1, fake.createEventCalls)
}

func TestCalculateDailyScoreCombinesEditableAndCanonicalFoodWater(t *testing.T) {
	fake := newFakePetRepo()
	fake.waterByDate["2026-09-28"] = 1200
	provider := &fakeFoodWaterProvider{logs: []healthdomain.BodyWaterLog{
		{ID: "food-water:record-1", AmountMl: 180, SourceType: healthdomain.FoodRecordWaterSourcePrefix + "record-1"},
		{ID: "food-water:record-2", AmountMl: 140, SourceType: healthdomain.FoodRecordWaterSourcePrefix + "record-2"},
	}}
	svc := NewService(fake)
	svc.ConfigureFoodWaterProvider(provider)

	score := svc.calculateDailyScore(context.Background(), "user-1", "2026-09-28")

	assert.Equal(t, 1520, score.Details["water_ml"])
	assert.Equal(t, true, score.Details["water_good"])
	assert.Equal(t, 1, provider.callCount)
	assert.Equal(t, "2026-09-28", provider.startDate)
	assert.Equal(t, "2026-09-28", provider.endDate)
}

func TestCalculateDailyScoreKeepsEditableWaterWhenCanonicalProviderFails(t *testing.T) {
	fake := newFakePetRepo()
	fake.waterByDate["2026-09-28"] = 900
	provider := &fakeFoodWaterProvider{err: errors.New("food water unavailable")}
	svc := NewService(fake)
	svc.ConfigureFoodWaterProvider(provider)

	score := svc.calculateDailyScore(context.Background(), "user-1", "2026-09-28")

	assert.Equal(t, 900, score.Details["water_ml"])
	assert.NotContains(t, score.Details, "water_good")
}

func TestSummaryShowsLowPowerWhenFoodRecordsStop(t *testing.T) {
	fake := newFakePetRepo()
	fake.foodByDate["2026-05-16"] = []repo.FoodRecord{
		{MealType: "breakfast", TotalCalories: 500, TotalProtein: 20},
	}
	svc := NewService(fake)

	summary, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, "low_power", summary.Status.State)
	assert.Equal(t, "sleepy", summary.Status.Mood)
	assert.Equal(t, 4, summary.Status.InactivityDays)
	assert.Contains(t, summary.Status.Message, "低电量")
	assert.Contains(t, summary.Status.TaskText, "充一点电")
}

func TestSummaryShowsDeepSleepButNotDeathAfterLongInactivity(t *testing.T) {
	fake := newFakePetRepo()
	fake.foodByDate["2026-05-01"] = []repo.FoodRecord{
		{MealType: "lunch", TotalCalories: 600, TotalProtein: 30},
	}
	svc := NewService(fake)

	summary, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, "deep_sleep", summary.Status.State)
	assert.Equal(t, 19, summary.Status.InactivityDays)
	assert.Contains(t, summary.Status.Message, "不会饿死")
}

func TestSummaryRevivesPetWhenFoodRecordReturns(t *testing.T) {
	fake := newFakePetRepo()
	fake.foodByDate["2026-05-16"] = []repo.FoodRecord{
		{MealType: "breakfast", TotalCalories: 500, TotalProtein: 20},
	}
	fake.foodByDate["2026-05-20"] = []repo.FoodRecord{
		{MealType: "dinner", TotalCalories: 700, TotalProtein: 35},
	}
	svc := NewService(fake)

	summary, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, 0, summary.Status.InactivityDays)
	assert.NotEqual(t, "sleepy", summary.Status.Mood)
	assert.Contains(t, summary.Status.Message, "睁眼")
}

func TestSummaryAutoProfileMatchPreservesExistingProgress(t *testing.T) {
	fake := newFakePetRepo()
	goal := "muscle_gain"
	fake.profile = &repo.UserProfile{
		ID:       "user-1",
		DietGoal: &goal,
		HealthCondition: map[string]any{
			"diet_preference": []any{"high_protein"},
		},
	}
	fake.pet = &petdomain.UserPet{
		ID:          "pet-1",
		UserID:      "user-1",
		PetSeed:     "pet:user-1:old",
		Name:        "旧名字",
		Color:       "mint",
		Shape:       "round",
		Pattern:     "pattern-0",
		Accessory:   "leaf",
		Personality: "gentle",
		Level:       4,
		Experience:  345,
		TotalEvents: 7,
		Meta:        map[string]any{},
	}
	svc := NewService(fake)

	result, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, "旧名字", result.Pet.Name)
	assert.Equal(t, 4, result.Pet.Level)
	assert.Equal(t, 345, result.Pet.Experience)
	assert.Equal(t, 7, result.Pet.TotalEvents)
	assert.Equal(t, archetypeProteinGuardian, result.Pet.Archetype)
	assert.True(t, result.Pet.FreeProfileRematchAvailable)
	require.Len(t, result.Pet.SelectionCandidates, 5)
}

func TestClaimEventIsIdempotent(t *testing.T) {
	fake := newFakePetRepo()
	fake.pet = &petdomain.UserPet{ID: "pet-1", UserID: "user-1", Level: 1}
	eventDate := mustParseDate("2026-05-19")
	fake.events["event-1"] = &petdomain.UserPetEvent{
		ID:           "event-1",
		UserID:       "user-1",
		PetID:        "pet-1",
		EventDate:    eventDate,
		EventType:    petdomain.EventTypeOfflineReview,
		ExpReward:    16,
		CreditReward: 1,
	}
	svc := NewService(fake)

	first, err := svc.ClaimEvent(context.Background(), "user-1", "event-1")
	require.NoError(t, err)
	assert.Equal(t, 1, first.CreditsAwarded)
	assert.Equal(t, 16, first.ExpAwarded)

	second, err := svc.ClaimEvent(context.Background(), "user-1", "event-1")
	require.NoError(t, err)
	assert.Equal(t, 0, second.CreditsAwarded)
	assert.Equal(t, 0, second.ExpAwarded)
	assert.Equal(t, 1, fake.balance)
	assert.Equal(t, 16, fake.pet.Experience)
}

func TestRerollAppearanceConsumesEarnedCredits(t *testing.T) {
	fake := newFakePetRepo()
	fake.pet = &petdomain.UserPet{
		ID:          "pet-1",
		UserID:      "user-1",
		PetSeed:     "pet:user-1",
		Name:        "薄荷团子",
		Color:       "mint",
		Shape:       "round",
		Pattern:     "pattern-0",
		Accessory:   "leaf",
		Personality: "gentle",
	}
	fake.balance = 9
	svc := NewService(fake)

	result, err := svc.RerollAppearance(context.Background(), "user-1")
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, petAppearanceRerollCost, result.CreditsCost)
	assert.NotEqual(t, "pet:user-1", result.Pet.PetSeed)
	assert.Equal(t, "薄荷团子", result.Pet.Name)
	require.NotNil(t, result.EarnedCreditsBalance)
	assert.Equal(t, 4, *result.EarnedCreditsBalance)
	assert.Equal(t, builtinAvatarType, result.Pet.AvatarType)
	assert.NotEmpty(t, result.Pet.BuiltinAvatarID)
	assert.NotEqual(t, builtinAvatarJianwen01ID, result.Pet.BuiltinAvatarID)
	assert.False(t, result.Pet.NeedsSelection)
}

func TestProfileUpgradeRepairsLegacyAndIncompleteAvatarsAutomatically(t *testing.T) {
	cases := []struct {
		name   string
		seed   string
		meta   map[string]any
		wantID string
	}{
		{"unversioned", "pet:old", nil, builtinAvatarJianwen01ID},
		{"old selected avatar", "pet:old", map[string]any{"profile_match_version": 2, "selected_candidate_id": "cand_old"}, builtinAvatarJianwen01ID},
		{"version5 missing image", "builtin:jianwen-01", map[string]any{"profile_match_version": 5}, builtinAvatarJianwen01ID},
		{"current version still missing image", "builtin:huatuo-01", map[string]any{"profile_match_version": petProfileMatchVersion}, builtinAvatarHuatuo01ID},
		{"recover selected image", "pet:old", map[string]any{"selected_candidate_id": "builtin:doudou-01"}, builtinAvatarDoudou01ID},
		{"preserve image choice", "pet:old", map[string]any{"avatar_type": builtinAvatarType, "builtin_avatar_id": "xiaomai-01"}, builtinAvatarXiaomai01ID},
		{"invalid custom avatar", "pet:old", map[string]any{"avatar_type": "pixel_self", "pixel_avatar_key": ""}, builtinAvatarJianwen01ID},
		{"unknown image id", "pet:old", map[string]any{"avatar_type": builtinAvatarType, "builtin_avatar_id": "retired"}, builtinAvatarJianwen01ID},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePetRepo()
			meta := cloneMeta(tt.meta)
			meta["profile_fingerprint"] = buildProfileMatch("user-1", nil).Fingerprint
			meta["custom_name"] = true
			meta["unrelated_preference"] = "keep"
			fake.pet = &petdomain.UserPet{ID: "pet-1", UserID: "user-1", PetSeed: tt.seed, Name: "牛来", Level: 4, Experience: 345, TotalEvents: 7, Meta: meta}
			svc := NewService(fake)
			upgraded, err := svc.ensureProfileMatch(context.Background(), "user-1", fake.pet, nil)
			require.NoError(t, err)
			view := svc.profileFromPet(upgraded)
			assert.Equal(t, builtinAvatarType, view.AvatarType)
			assert.Equal(t, tt.wantID, view.BuiltinAvatarID)
			assert.Equal(t, "builtin:"+tt.wantID, view.PetSeed)
			assert.False(t, view.NeedsSelection)
			assert.Equal(t, "牛来", view.Name)
			assert.Equal(t, 4, view.Level)
			assert.Equal(t, 345, view.Experience)
			assert.Equal(t, 7, view.TotalEvents)
			assert.Equal(t, "keep", upgraded.Meta["unrelated_preference"])
			assert.Zero(t, fake.balance)
			_, err = svc.ensureProfileMatch(context.Background(), "user-1", upgraded, nil)
			require.NoError(t, err)
			assert.Equal(t, 1, fake.profileUpgradeCalls, "the next read must not rewrite the profile")
		})
	}
}

func TestProfileUpgradePreservesCustomAvatarAndConcurrentChanges(t *testing.T) {
	for _, concurrent := range []bool{false, true} {
		t.Run(fmt.Sprintf("concurrent=%t", concurrent), func(t *testing.T) {
			fake := newFakePetRepo()
			custom := map[string]any{"avatar_type": "pixel_self", "pixel_avatar_key": "photos/custom.png", "pixel_avatar_jump_key": "photos/jump.png", "custom_name": true}
			fake.pet = &petdomain.UserPet{ID: "pet-1", UserID: "user-1", PetSeed: "pet:original", Name: "牛来", Level: 4, Experience: 345, Meta: cloneMeta(custom)}
			if concurrent {
				fake.pet.Meta = map[string]any{}
				fake.beforeProfileUpgrade = func(f *fakePetRepo) { f.pet.Meta = cloneMeta(custom); f.pet.Name = "刚改的新名字" }
			}
			svc := NewService(fake)
			viewPet, err := svc.ensureProfileMatch(context.Background(), "user-1", fake.pet, nil)
			require.NoError(t, err)
			assert.Equal(t, "pixel_self", viewPet.Meta["avatar_type"])
			assert.Equal(t, "photos/custom.png", viewPet.Meta["pixel_avatar_key"])
			assert.Equal(t, "photos/jump.png", viewPet.Meta["pixel_avatar_jump_key"])
			assert.Equal(t, "pet:original", viewPet.PetSeed)
			assert.Equal(t, 345, viewPet.Experience)
			assert.Empty(t, viewPet.Meta["builtin_avatar_id"])
			assert.False(t, svc.profileFromPet(viewPet).NeedsSelection)
			if concurrent {
				assert.Equal(t, "刚改的新名字", viewPet.Name)
				assert.Equal(t, 2, fake.profileUpgradeCalls)
			}
			calls := fake.profileUpgradeCalls
			_, err = svc.ensureProfileMatch(context.Background(), "user-1", viewPet, nil)
			require.NoError(t, err)
			assert.Equal(t, calls, fake.profileUpgradeCalls)
		})
	}
}

func TestRerollAppearanceRequiresEnoughEarnedCredits(t *testing.T) {
	fake := newFakePetRepo()
	fake.pet = &petdomain.UserPet{
		ID:      "pet-1",
		UserID:  "user-1",
		PetSeed: "pet:user-1",
		Name:    "薄荷团子",
	}
	fake.balance = 3
	svc := NewService(fake)

	result, err := svc.RerollAppearance(context.Background(), "user-1")
	require.Error(t, err)
	assert.Nil(t, result)
	assert.True(t, IsInsufficientEarnedCreditsError(err))
}

func TestSelectAppearanceUsesCurrentCandidatesAndIsIdempotent(t *testing.T) {
	fake := newFakePetRepo()
	goal := "fat_loss"
	fake.profile = &repo.UserProfile{ID: "user-1", DietGoal: &goal}
	svc := NewService(fake)

	summary, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	require.Len(t, summary.Pet.SelectionCandidates, 5)
	candidate := summary.Pet.SelectionCandidates[1]

	first, err := svc.SelectAppearance(context.Background(), "user-1", candidate.ID)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, candidate.PetSeed, first.Pet.PetSeed)
	assert.Equal(t, candidate.Name, first.Pet.Name)
	assert.False(t, first.Pet.NeedsSelection)

	second, err := svc.SelectAppearance(context.Background(), "user-1", candidate.ID)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, first.Pet.PetSeed, second.Pet.PetSeed)
}

func TestSelectBuiltinAppearancePersistsAcrossSummary(t *testing.T) {
	fake := newFakePetRepo()
	svc := NewService(fake)

	summary, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	require.Len(t, summary.Pet.SelectionCandidates, 5)
	var builtin AppearanceCandidate
	for _, candidate := range summary.Pet.SelectionCandidates {
		if candidate.BuiltinAvatarID == builtinAvatarJianwen01ID {
			builtin = candidate
			break
		}
	}
	assert.Equal(t, builtinAvatarJianwen01ID, builtin.BuiltinAvatarID)

	selected, err := svc.SelectAppearance(context.Background(), "user-1", builtin.ID)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, builtinAvatarType, selected.Pet.AvatarType)
	assert.Equal(t, builtinAvatarJianwen01ID, selected.Pet.BuiltinAvatarID)
	assert.Equal(t, builtin.Name, selected.Pet.Name)
	assert.True(t, selected.Pet.FreeProfileRematchAvailable)

	reloaded, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, builtinAvatarType, reloaded.Pet.AvatarType)
	assert.Equal(t, builtinAvatarJianwen01ID, reloaded.Pet.BuiltinAvatarID)
}

func TestBuiltinAppearanceCandidatesIncludeWellnessCharacters(t *testing.T) {
	candidates := builtinAppearanceCandidates()
	require.Len(t, candidates, 5)

	byID := make(map[string]AppearanceCandidate, len(candidates))
	for _, candidate := range candidates {
		byID[candidate.BuiltinAvatarID] = candidate
		assert.Equal(t, builtinAvatarType, candidate.AvatarType)
		assert.Equal(t, "builtin:"+candidate.BuiltinAvatarID, candidate.ID)
	}

	assert.Equal(t, "华佗", byID[builtinAvatarHuatuo01ID].Name)
	assert.Equal(t, "太极小子", byID[builtinAvatarTaijiXiaoziID].Name)
	assert.Equal(t, "小麦", byID[builtinAvatarXiaomai01ID].Name)
	assert.Equal(t, "豆豆", byID[builtinAvatarDoudou01ID].Name)
}

func TestSelectWellnessBuiltinAppearancesPersists(t *testing.T) {
	tests := []struct {
		name     string
		avatarID string
		petName  string
	}{
		{name: "华佗", avatarID: builtinAvatarHuatuo01ID, petName: "华佗"},
		{name: "太极小子", avatarID: builtinAvatarTaijiXiaoziID, petName: "太极小子"},
		{name: "小麦", avatarID: builtinAvatarXiaomai01ID, petName: "小麦"},
		{name: "豆豆", avatarID: builtinAvatarDoudou01ID, petName: "豆豆"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePetRepo()
			svc := NewService(fake)

			selected, err := svc.SelectAppearance(context.Background(), "user-1", "builtin:"+tt.avatarID)
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, builtinAvatarType, selected.Pet.AvatarType)
			assert.Equal(t, tt.avatarID, selected.Pet.BuiltinAvatarID)
			assert.Equal(t, tt.petName, selected.Pet.Name)

			reloaded, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
			require.NoError(t, err)
			assert.Equal(t, tt.avatarID, reloaded.Pet.BuiltinAvatarID)
			assert.Equal(t, tt.petName, reloaded.Pet.Name)
		})
	}
}

func TestSelectAppearanceRejectsUnknownCandidate(t *testing.T) {
	fake := newFakePetRepo()
	svc := NewService(fake)

	_, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	result, err := svc.SelectAppearance(context.Background(), "user-1", "missing")
	require.Error(t, err)
	assert.Nil(t, result)
}
