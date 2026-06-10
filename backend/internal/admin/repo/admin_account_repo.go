package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/admin/domain"

	"gorm.io/gorm"
)

type AdminAccountModel struct {
	ID           string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Username     string     `gorm:"column:username;type:text;not null;uniqueIndex:idx_admin_accounts_username"`
	DisplayName  string     `gorm:"column:display_name;type:text;not null;default:''"`
	PasswordHash string     `gorm:"column:password_hash;type:text;not null"`
	Status       string     `gorm:"column:status;type:text;not null;default:'active';index:idx_admin_accounts_status"`
	LastLoginAt  *time.Time `gorm:"column:last_login_at;type:timestamptz"`
	CreatedAt    time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (AdminAccountModel) TableName() string { return "admin_accounts" }

type AdminAccountRepo struct {
	db *gorm.DB
}

func NewAdminAccountRepo(db *gorm.DB) *AdminAccountRepo {
	return &AdminAccountRepo{db: db}
}

func (r *AdminAccountRepo) FindByUsername(ctx context.Context, username string) (*domain.AdminAccount, error) {
	var model AdminAccountModel
	if err := r.db.WithContext(ctx).Where("username = ?", username).First(&model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return adminAccountFromModel(model), nil
}

func (r *AdminAccountRepo) FindByID(ctx context.Context, id string) (*domain.AdminAccount, error) {
	var model AdminAccountModel
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return adminAccountFromModel(model), nil
}

func (r *AdminAccountRepo) Create(ctx context.Context, account *domain.AdminAccount) (*domain.AdminAccount, error) {
	model := AdminAccountModel{
		Username:     account.Username,
		DisplayName:  account.DisplayName,
		PasswordHash: account.PasswordHash,
		Status:       account.Status,
	}
	if err := r.db.WithContext(ctx).Create(&model).Error; err != nil {
		return nil, err
	}
	return adminAccountFromModel(model), nil
}

func (r *AdminAccountRepo) UpdatePassword(ctx context.Context, id, passwordHash, displayName string) (*domain.AdminAccount, error) {
	updates := map[string]any{
		"password_hash": passwordHash,
		"status":        domain.AdminAccountStatusActive,
		"updated_at":    time.Now(),
	}
	if displayName != "" {
		updates["display_name"] = displayName
	}
	if err := r.db.WithContext(ctx).Model(&AdminAccountModel{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

func (r *AdminAccountRepo) TouchLastLogin(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&AdminAccountModel{}).Where("id = ?", id).Updates(map[string]any{
		"last_login_at": time.Now(),
		"updated_at":    time.Now(),
	}).Error
}

func adminAccountFromModel(model AdminAccountModel) *domain.AdminAccount {
	return &domain.AdminAccount{
		ID:           model.ID,
		Username:     model.Username,
		DisplayName:  model.DisplayName,
		PasswordHash: model.PasswordHash,
		Status:       model.Status,
		LastLoginAt:  model.LastLoginAt,
		CreatedAt:    model.CreatedAt,
		UpdatedAt:    model.UpdatedAt,
	}
}
