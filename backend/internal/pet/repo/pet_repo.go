package repo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"food_link/backend/internal/membership/domain"
	petdomain "food_link/backend/internal/pet/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrInsufficientEarnedCredits = errors.New("insufficient earned credits")

type FoodRecord struct {
	ID            string     `gorm:"column:id"`
	MealType      string     `gorm:"column:meal_type"`
	RecordTime    *time.Time `gorm:"column:record_time"`
	TotalCalories float64    `gorm:"column:total_calories"`
	TotalProtein  float64    `gorm:"column:total_protein"`
	TotalCarbs    float64    `gorm:"column:total_carbs"`
	TotalFat      float64    `gorm:"column:total_fat"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type UserProfile struct {
	ID              string         `gorm:"column:id"`
	Gender          *string        `gorm:"column:gender"`
	Birthday        *time.Time     `gorm:"column:birthday"`
	ActivityLevel   *string        `gorm:"column:activity_level"`
	DietGoal        *string        `gorm:"column:diet_goal"`
	HealthCondition map[string]any `gorm:"column:health_condition;serializer:json"`
}

func (UserProfile) TableName() string { return "weapp_user" }

type PetRepo struct {
	db *gorm.DB
}

func NewPetRepo(db *gorm.DB) *PetRepo {
	return &PetRepo{db: db}
}

func (r *PetRepo) GetPetByUserID(ctx context.Context, userID string) (*petdomain.UserPet, error) {
	var row petdomain.UserPet
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) CreatePet(ctx context.Context, pet *petdomain.UserPet) error {
	if pet.ID == "" {
		pet.ID = uuid.New().String()
	}
	now := time.Now()
	if pet.CreatedAt == nil {
		pet.CreatedAt = &now
	}
	pet.UpdatedAt = &now
	meta, err := jsonbValue(pet.Meta)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoNothing: true}).
		Table(pet.TableName()).
		Create(map[string]any{
			"id":              pet.ID,
			"user_id":         pet.UserID,
			"pet_seed":        pet.PetSeed,
			"name":            pet.Name,
			"color":           pet.Color,
			"shape":           pet.Shape,
			"pattern":         pet.Pattern,
			"accessory":       pet.Accessory,
			"personality":     pet.Personality,
			"level":           pet.Level,
			"experience":      pet.Experience,
			"today_status":    pet.TodayStatus,
			"last_settled_on": pet.LastSettledOn,
			"total_events":    pet.TotalEvents,
			"last_summary_at": pet.LastSummaryAt,
			"meta":            meta,
			"created_at":      pet.CreatedAt,
			"updated_at":      pet.UpdatedAt,
		}).Error
}

func (r *PetRepo) GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
	var row UserProfile
	err := r.db.WithContext(ctx).
		Select("id", "gender", "birthday", "activity_level", "diet_goal", "health_condition").
		Where("id = ?", userID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) UpdatePet(ctx context.Context, petID string, updates map[string]any) error {
	updates["updated_at"] = time.Now()
	normalizedUpdates, err := normalizePetJSONUpdates(updates, "meta")
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&petdomain.UserPet{}).Where("id = ?", petID).Updates(normalizedUpdates).Error
}

func (r *PetRepo) SelectAppearance(ctx context.Context, userID, petID string, updates map[string]any) (*petdomain.UserPet, error) {
	var updatedPet petdomain.UserPet
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", petID, userID).
			First(&updatedPet).Error; err != nil {
			return err
		}
		updates["updated_at"] = time.Now()
		normalizedUpdates, err := normalizePetJSONUpdates(updates, "meta")
		if err != nil {
			return err
		}
		if err := tx.Model(&petdomain.UserPet{}).Where("id = ?", petID).Updates(normalizedUpdates).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", petID).First(&updatedPet).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &updatedPet, nil
}

func (r *PetRepo) AddPetExperience(ctx context.Context, petID string, delta int) (*petdomain.UserPet, error) {
	if delta < 0 {
		delta = 0
	}
	var pet petdomain.UserPet
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", petID).First(&pet).Error; err != nil {
			return err
		}
		nextExp := pet.Experience + delta
		nextLevel := LevelForExperience(nextExp)
		if err := tx.Model(&petdomain.UserPet{}).Where("id = ?", petID).Updates(map[string]any{
			"experience": nextExp,
			"level":      nextLevel,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		pet.Experience = nextExp
		pet.Level = nextLevel
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pet, nil
}

func (r *PetRepo) ListFoodRecordsByDate(ctx context.Context, userID, date string) ([]FoodRecord, error) {
	start, end, err := chinaDateWindow(date)
	if err != nil {
		return nil, err
	}
	var rows []FoodRecord
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, start, end).
		Find(&rows).Error
	return rows, err
}

func (r *PetRepo) GetLatestFoodRecordDate(ctx context.Context, userID string, beforeOrOn string) (string, error) {
	_, end, err := chinaDateWindow(beforeOrOn)
	if err != nil {
		return "", err
	}
	var row FoodRecord
	err = r.db.WithContext(ctx).
		Select("record_time").
		Where("user_id = ? AND record_time < ?", userID, end).
		Order("record_time DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if row.RecordTime == nil {
		return "", nil
	}
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	return row.RecordTime.In(loc).Format("2006-01-02"), nil
}

func (r *PetRepo) SumWaterByDate(ctx context.Context, userID, date string) (int, error) {
	var total int
	err := r.db.WithContext(ctx).
		Table("user_water_logs").
		Select("COALESCE(SUM(amount_ml), 0)").
		Where("user_id = ? AND recorded_on = ?", userID, date).
		Scan(&total).Error
	return total, err
}

func (r *PetRepo) SumExerciseByDate(ctx context.Context, userID, date string) (int, error) {
	var total int
	err := r.db.WithContext(ctx).
		Table("user_exercise_logs").
		Select("COALESCE(SUM(calories_burned), 0)").
		Where("user_id = ? AND recorded_on = ?", userID, date).
		Scan(&total).Error
	return total, err
}

func (r *PetRepo) GetDailyScore(ctx context.Context, userID, date string) (*petdomain.UserPetDailyScore, error) {
	scoreDate, err := parseChinaDate(date)
	if err != nil {
		return nil, err
	}
	var row petdomain.UserPetDailyScore
	err = r.db.WithContext(ctx).Where("user_id = ? AND score_date = ?", userID, scoreDate).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) CreateDailyScore(ctx context.Context, row *petdomain.UserPetDailyScore) (bool, error) {
	if row.ID == "" {
		row.ID = uuid.New().String()
	}
	now := time.Now()
	if row.CreatedAt == nil {
		row.CreatedAt = &now
	}
	row.UpdatedAt = &now
	scoreDetails, err := jsonbValue(row.ScoreDetails)
	if err != nil {
		return false, err
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "score_date"}},
			DoNothing: true,
		}).
		Table(row.TableName()).
		Create(map[string]any{
			"id":            row.ID,
			"user_id":       row.UserID,
			"score_date":    row.ScoreDate,
			"habit_score":   row.HabitScore,
			"exp_gained":    row.ExpGained,
			"score_details": scoreDetails,
			"created_at":    row.CreatedAt,
			"updated_at":    row.UpdatedAt,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func (r *PetRepo) UpdateDailyScore(ctx context.Context, id string, updates map[string]any) error {
	updates["updated_at"] = time.Now()
	normalizedUpdates, err := normalizePetJSONUpdates(updates, "score_details")
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&petdomain.UserPetDailyScore{}).Where("id = ?", id).Updates(normalizedUpdates).Error
}

func (r *PetRepo) GetEventByUserDateType(ctx context.Context, userID, date, eventType string) (*petdomain.UserPetEvent, error) {
	eventDate, err := parseChinaDate(date)
	if err != nil {
		return nil, err
	}
	var row petdomain.UserPetEvent
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND event_date = ? AND event_type = ?", userID, eventDate, eventType).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) GetEventByID(ctx context.Context, userID, eventID string) (*petdomain.UserPetEvent, error) {
	var row petdomain.UserPetEvent
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", eventID, userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) GetLatestUnclaimedEvent(ctx context.Context, userID string) (*petdomain.UserPetEvent, error) {
	var row petdomain.UserPetEvent
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND is_claimed = ?", userID, false).
		Order("event_date DESC").
		Order("created_at DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PetRepo) CreateEvent(ctx context.Context, row *petdomain.UserPetEvent) error {
	if row.ID == "" {
		row.ID = uuid.New().String()
	}
	now := time.Now()
	if row.CreatedAt == nil {
		row.CreatedAt = &now
	}
	row.UpdatedAt = &now
	scoreDetails, err := jsonbValue(row.ScoreDetails)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "event_date"}, {Name: "event_type"}},
			DoNothing: true,
		}).
		Table(row.TableName()).
		Create(map[string]any{
			"id":            row.ID,
			"user_id":       row.UserID,
			"pet_id":        row.PetID,
			"event_date":    row.EventDate,
			"event_type":    row.EventType,
			"title":         row.Title,
			"message":       row.Message,
			"task_text":     row.TaskText,
			"habit_score":   row.HabitScore,
			"exp_reward":    row.ExpReward,
			"credit_reward": row.CreditReward,
			"score_details": scoreDetails,
			"is_read":       row.IsRead,
			"read_at":       row.ReadAt,
			"is_claimed":    row.IsClaimed,
			"claimed_at":    row.ClaimedAt,
			"created_at":    row.CreatedAt,
			"updated_at":    row.UpdatedAt,
		}).Error
}

func (r *PetRepo) MarkEventRead(ctx context.Context, eventID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&petdomain.UserPetEvent{}).
		Where("id = ? AND is_read = ?", eventID, false).
		Updates(map[string]any{"is_read": true, "read_at": now, "updated_at": now}).Error
}

func (r *PetRepo) ClaimEvent(ctx context.Context, userID, eventID string, expReward, creditReward int, relatedDate string, meta map[string]any) (*petdomain.UserPetEvent, *petdomain.UserPet, *domain.UserEarnedCreditLedger, bool, error) {
	var claimedEvent petdomain.UserPetEvent
	var updatedPet petdomain.UserPet
	var ledger *domain.UserEarnedCreditLedger
	appliedCredit := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", eventID, userID).
			First(&claimedEvent).Error; err != nil {
			return err
		}
		if claimedEvent.IsClaimed {
			return tx.Where("id = ?", claimedEvent.PetID).First(&updatedPet).Error
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", claimedEvent.PetID).First(&updatedPet).Error; err != nil {
			return err
		}
		if expReward > 0 {
			updatedPet.Experience += expReward
			updatedPet.Level = LevelForExperience(updatedPet.Experience)
		}
		now := time.Now()
		if err := tx.Model(&petdomain.UserPet{}).Where("id = ?", updatedPet.ID).Updates(map[string]any{
			"experience":   updatedPet.Experience,
			"level":        updatedPet.Level,
			"total_events": gorm.Expr("total_events + 1"),
			"today_status": "surprised",
			"updated_at":   now,
		}).Error; err != nil {
			return err
		}
		updatedPet.TotalEvents++
		if creditReward > 0 {
			relatedDateValue := relatedDate
			sourceKey := "pet_offline_reward:" + eventID
			var existing domain.UserEarnedCreditLedger
			err := tx.Where("user_id = ? AND reason = ? AND source_key = ?", userID, "pet_offline_reward", sourceKey).First(&existing).Error
			if err == nil {
				ledger = &existing
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			} else {
				var user struct {
					EarnedCreditsBalance int `gorm:"column:earned_credits_balance"`
				}
				if err := tx.Table("weapp_user").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error; err != nil {
					return err
				}
				next := user.EarnedCreditsBalance + creditReward
				if err := tx.Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", next).Error; err != nil {
					return err
				}
				ledgerMeta, err := jsonbValue(meta)
				if err != nil {
					return err
				}
				row := &domain.UserEarnedCreditLedger{
					ID:           uuid.New().String(),
					UserID:       userID,
					Delta:        creditReward,
					BalanceAfter: next,
					Reason:       "pet_offline_reward",
					SourceKey:    &sourceKey,
					RelatedDate:  &relatedDateValue,
					Meta:         meta,
					CreatedAt:    &now,
					UpdatedAt:    &now,
				}
				if err := tx.Table(row.TableName()).Create(map[string]any{
					"id":            row.ID,
					"user_id":       row.UserID,
					"delta":         row.Delta,
					"balance_after": row.BalanceAfter,
					"reason":        row.Reason,
					"source_key":    row.SourceKey,
					"related_date":  row.RelatedDate,
					"meta":          ledgerMeta,
					"created_at":    row.CreatedAt,
					"updated_at":    row.UpdatedAt,
				}).Error; err != nil {
					return err
				}
				ledger = row
				appliedCredit = true
			}
		}
		if err := tx.Model(&petdomain.UserPetEvent{}).Where("id = ?", eventID).Updates(map[string]any{
			"is_read":    true,
			"read_at":    now,
			"is_claimed": true,
			"claimed_at": now,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		claimedEvent.IsRead = true
		claimedEvent.ReadAt = &now
		claimedEvent.IsClaimed = true
		claimedEvent.ClaimedAt = &now
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil, false, nil
	}
	if err != nil {
		return nil, nil, nil, false, err
	}
	return &claimedEvent, &updatedPet, ledger, appliedCredit, nil
}

func (r *PetRepo) RerollAppearance(ctx context.Context, userID, petID string, updates map[string]any, cost int, meta map[string]any) (*petdomain.UserPet, *domain.UserEarnedCreditLedger, error) {
	var updatedPet petdomain.UserPet
	var ledger *domain.UserEarnedCreditLedger
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", petID, userID).
			First(&updatedPet).Error; err != nil {
			return err
		}

		if cost > 0 {
			var user struct {
				EarnedCreditsBalance int `gorm:"column:earned_credits_balance"`
			}
			if err := tx.Table("weapp_user").
				Clauses(clause.Locking{Strength: "UPDATE"}).
				Select("earned_credits_balance").
				Where("id = ?", userID).
				First(&user).Error; err != nil {
				return err
			}
			next := user.EarnedCreditsBalance - cost
			if next < 0 {
				return ErrInsufficientEarnedCredits
			}
			if err := tx.Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", next).Error; err != nil {
				return err
			}
			now := time.Now()
			ledgerMeta, err := jsonbValue(meta)
			if err != nil {
				return err
			}
			ledger = &domain.UserEarnedCreditLedger{
				ID:           uuid.New().String(),
				UserID:       userID,
				Delta:        -cost,
				BalanceAfter: next,
				Reason:       "pet_appearance_reroll_spend",
				Meta:         meta,
				CreatedAt:    &now,
				UpdatedAt:    &now,
			}
			if err := tx.Table(ledger.TableName()).Create(map[string]any{
				"id":            ledger.ID,
				"user_id":       ledger.UserID,
				"delta":         ledger.Delta,
				"balance_after": ledger.BalanceAfter,
				"reason":        ledger.Reason,
				"source_key":    ledger.SourceKey,
				"related_date":  ledger.RelatedDate,
				"meta":          ledgerMeta,
				"created_at":    ledger.CreatedAt,
				"updated_at":    ledger.UpdatedAt,
			}).Error; err != nil {
				return err
			}
		}

		updates["updated_at"] = time.Now()
		normalizedUpdates, err := normalizePetJSONUpdates(updates, "meta")
		if err != nil {
			return err
		}
		if err := tx.Model(&petdomain.UserPet{}).Where("id = ?", petID).Updates(normalizedUpdates).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", petID).First(&updatedPet).Error
	})
	if err != nil {
		return nil, nil, err
	}
	return &updatedPet, ledger, nil
}

func LevelForExperience(experience int) int {
	if experience < 0 {
		experience = 0
	}
	return experience/100 + 1
}

func chinaDateWindow(date string) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	day, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return day, day.AddDate(0, 0, 1), nil
}

func parseChinaDate(date string) (time.Time, error) {
	return time.Parse("2006-01-02", date)
}

func normalizePetJSONUpdates(updates map[string]any, jsonKeys ...string) (map[string]any, error) {
	if len(updates) == 0 {
		return updates, nil
	}
	jsonKeySet := make(map[string]struct{}, len(jsonKeys))
	for _, key := range jsonKeys {
		jsonKeySet[key] = struct{}{}
	}
	out := make(map[string]any, len(updates))
	for key, value := range updates {
		if _, ok := jsonKeySet[key]; !ok {
			out[key] = value
			continue
		}
		encoded, err := jsonbValue(value)
		if err != nil {
			return nil, err
		}
		out[key] = encoded
	}
	return out, nil
}

func jsonbValue(value any) (datatypes.JSON, error) {
	if value == nil {
		value = map[string]any{}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(encoded), nil
}
