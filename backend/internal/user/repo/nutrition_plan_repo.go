package repo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/user/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type NutritionPlanRow struct {
	ID        string                     `gorm:"column:id;primaryKey"`
	UserID    string                     `gorm:"column:user_id"`
	Revision  int                        `gorm:"column:revision"`
	Values    domain.NutritionPlanValues `gorm:"column:values;serializer:json"`
	Archived  bool                       `gorm:"column:archived"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (NutritionPlanRow) TableName() string { return "user_nutrition_plans" }

type NutritionDefaultRow struct {
	ID            string                       `gorm:"column:id;primaryKey"`
	UserID        string                       `gorm:"column:user_id"`
	EffectiveDate time.Time                    `gorm:"column:effective_date"`
	Snapshot      domain.NutritionPlanSnapshot `gorm:"column:snapshot;serializer:json"`
	CreatedAt     time.Time
}

func (NutritionDefaultRow) TableName() string { return "user_nutrition_plan_defaults" }

type NutritionPlanRepo struct{ db *gorm.DB }

func NewNutritionPlanRepo(db *gorm.DB) *NutritionPlanRepo { return &NutritionPlanRepo{db: db} }
func (r *NutritionPlanRepo) UpdateOwnerFields(ctx context.Context, userID string, updates map[string]any) (*authrepo.User, error) {
	return authrepo.NewUserRepo(r.db).UpdateFields(ctx, userID, updates)
}
func (r *NutritionPlanRepo) SchemaReady() bool {
	return r.db.Migrator().HasTable(&NutritionPlanRow{}) && r.db.Migrator().HasTable(&NutritionDefaultRow{}) && r.db.Migrator().HasColumn(&domain.DailyNutritionTarget{}, "plan_snapshot")
}

// Lock the owner even when no plan/day row exists yet, so imports, defaults and
// day changes cannot race with another request for this same account.
func (r *NutritionPlanRepo) WithOwner(ctx context.Context, userID string, fn func(*NutritionPlanRepo, *authrepo.User) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user authrepo.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		return fn(NewNutritionPlanRepo(tx), &user)
	})
}
func (r *NutritionPlanRepo) Owner(ctx context.Context, userID string) (*authrepo.User, error) {
	var user authrepo.User
	err := r.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error
	return &user, err
}
func (r *NutritionPlanRepo) Plans(ctx context.Context, userID string) ([]NutritionPlanRow, error) {
	rows := []NutritionPlanRow{}
	err := r.db.WithContext(ctx).Where("user_id = ? AND archived = ?", userID, false).Order("created_at ASC, id ASC").Find(&rows).Error
	return rows, err
}
func (r *NutritionPlanRepo) Plan(ctx context.Context, userID, id string) (*NutritionPlanRow, error) {
	var row NutritionPlanRow
	err := r.db.WithContext(ctx).Where("user_id = ? AND id = ? AND archived = ?", userID, id, false).First(&row).Error
	return &row, err
}
func (r *NutritionPlanRepo) Create(ctx context.Context, userID string, values []domain.NutritionPlanValues) error {
	rows := make([]NutritionPlanRow, len(values))
	now := time.Now().UTC()
	for i, v := range values {
		created := now.Add(time.Duration(i) * time.Microsecond)
		rows[i] = NutritionPlanRow{ID: uuid.NewString(), UserID: userID, Revision: 1, Values: v, CreatedAt: created, UpdatedAt: created}
	}
	return r.db.WithContext(ctx).Create(&rows).Error
}
func (r *NutritionPlanRepo) Update(ctx context.Context, userID, id string, revision int, values domain.NutritionPlanValues) error {
	encoded, err := json.Marshal(values)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&NutritionPlanRow{}).Where("user_id = ? AND id = ?", userID, id).
		Updates(map[string]any{"revision": revision, "values": string(encoded), "updated_at": time.Now().UTC()}).Error
}
func (r *NutritionPlanRepo) Archive(ctx context.Context, userID, id string) error {
	return r.db.WithContext(ctx).Model(&NutritionPlanRow{}).Where("user_id = ? AND id = ?", userID, id).Update("archived", true).Error
}
func (r *NutritionPlanRepo) Defaults(ctx context.Context, userID, end string) ([]NutritionDefaultRow, error) {
	rows := []NutritionDefaultRow{}
	err := r.db.WithContext(ctx).Where("user_id = ? AND effective_date <= ?", userID, end).Order("effective_date ASC").Find(&rows).Error
	return rows, err
}
func (r *NutritionPlanRepo) SetDefault(ctx context.Context, userID, date string, snapshot domain.NutritionPlanSnapshot, replaceFuture bool) error {
	if replaceFuture {
		if err := r.db.WithContext(ctx).Where("user_id = ? AND effective_date > ?", userID, date).Delete(&NutritionDefaultRow{}).Error; err != nil {
			return err
		}
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return err
	}
	row := NutritionDefaultRow{ID: uuid.NewString(), UserID: userID, EffectiveDate: d, Snapshot: snapshot, CreatedAt: time.Now().UTC()}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "effective_date"}}, DoUpdates: clause.AssignmentColumns([]string{"snapshot"})}).Create(&row).Error
}
func (r *NutritionPlanRepo) Days(ctx context.Context, userID, start, end string) ([]domain.DailyNutritionTarget, error) {
	rows := []domain.DailyNutritionTarget{}
	err := r.db.WithContext(ctx).Where("user_id = ? AND target_date >= ? AND target_date <= ?", userID, start, end).Find(&rows).Error
	return rows, err
}
func (r *NutritionPlanRepo) Day(ctx context.Context, userID, date string) (*domain.DailyNutritionTarget, error) {
	var row domain.DailyNutritionTarget
	err := r.db.WithContext(ctx).Where("user_id = ? AND target_date = ?", userID, date).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}
func (r *NutritionPlanRepo) PutDay(ctx context.Context, userID, date, source string, snapshot domain.NutritionPlanSnapshot) error {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	row := domain.DailyNutritionTarget{ID: uuid.NewString(), UserID: userID, TargetDate: d, Source: source, CreatedAt: &now, UpdatedAt: &now, PlanSnapshot: &snapshot,
		CalorieTarget: snapshot.Targets["calorie_target"], ProteinTarget: snapshot.Targets["protein_target"], CarbsTarget: snapshot.Targets["carbs_target"], FatTarget: snapshot.Targets["fat_target"]}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "target_date"}}, DoUpdates: clause.AssignmentColumns([]string{"calorie_target", "protein_target", "carbs_target", "fat_target", "source", "plan_snapshot", "updated_at"})}).Create(&row).Error
}
func (r *NutritionPlanRepo) ClearDay(ctx context.Context, userID, date string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND target_date = ?", userID, date).Delete(&domain.DailyNutritionTarget{}).Error
}
