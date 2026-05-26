package service

import (
	"context"
	"errors"
	"testing"
	"time"

	membershipdomain "food_link/backend/internal/membership/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/internal/pet/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePetRepo struct {
	pet              *petdomain.UserPet
	dailyScores      map[string]*petdomain.UserPetDailyScore
	events           map[string]*petdomain.UserPetEvent
	foodByDate       map[string][]repo.FoodRecord
	waterByDate      map[string]int
	exerciseByDate   map[string]int
	createPetCalls   int
	createEventCalls int
	balance          int
	nextID           int
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
	return nil
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

func (f *fakePetRepo) SumWaterByDate(ctx context.Context, userID, date string) (int, error) {
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
	copy := *f.pet
	ledger := &membershipdomain.UserEarnedCreditLedger{BalanceAfter: f.balance}
	return &copy, ledger, nil
}

func TestSummaryCreatesStablePetAndSingleOfflineEvent(t *testing.T) {
	fake := newFakePetRepo()
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

	second, err := svc.Summary(context.Background(), "user-1", "2026-05-20")
	require.NoError(t, err)
	assert.Equal(t, first.Pet.ID, second.Pet.ID)
	assert.Equal(t, 1, fake.createPetCalls)
	assert.Equal(t, 1, fake.createEventCalls)
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
