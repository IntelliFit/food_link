package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PublicFoodRepo struct {
	db *gorm.DB
}

func NewPublicFoodRepo(db *gorm.DB) *PublicFoodRepo {
	return &PublicFoodRepo{db: db}
}

type ListFilter struct {
	City               string
	SuitableForFatLoss *bool
	MerchantName       string
	MinCalories        *float64
	MaxCalories        *float64
	SortBy             string
	Limit              int
	Offset             int
}

func (r *PublicFoodRepo) CreateItem(ctx context.Context, item *domain.PublicFoodItem) error {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *PublicFoodRepo) UpdateStatus(ctx context.Context, itemID, status string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if status == "published" {
		updates["published_at"] = time.Now()
	}
	return r.db.WithContext(ctx).Model(&domain.PublicFoodItem{}).Where("id = ?", itemID).Updates(updates).Error
}

func (r *PublicFoodRepo) ListPublished(ctx context.Context, f ListFilter) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	q := r.db.WithContext(ctx).Where("status = ?", "published")
	if f.City != "" {
		q = q.Where("city = ?", f.City)
	}
	if f.SuitableForFatLoss != nil {
		q = q.Where("suitable_for_fat_loss = ?", *f.SuitableForFatLoss)
	}
	if f.MerchantName != "" {
		q = q.Where("merchant_name ILIKE ?", "%"+f.MerchantName+"%")
	}
	if f.MinCalories != nil {
		q = q.Where("total_calories >= ?", *f.MinCalories)
	}
	if f.MaxCalories != nil {
		q = q.Where("total_calories <= ?", *f.MaxCalories)
	}
	switch f.SortBy {
	case "hot":
		q = q.Order("like_count desc")
	case "rating":
		q = q.Order("avg_rating desc")
	default:
		q = q.Order("published_at desc NULLS LAST, created_at desc")
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	err := q.Limit(f.Limit).Offset(f.Offset).Find(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListMine(ctx context.Context, userID string, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND status NOT IN ?", userID, []string{"user_deleted", "deleted"}).
		Order("created_at desc").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListCollected(ctx context.Context, userID string, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*").
		Joins("JOIN public_food_library_collections c ON c.library_item_id = p.id").
		Where("c.user_id = ? AND p.status = ?", userID, "published").
		Order("c.created_at desc").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) GetItem(ctx context.Context, itemID string) (*domain.PublicFoodItem, error) {
	var row domain.PublicFoodItem
	err := r.db.WithContext(ctx).Where("id = ?", itemID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PublicFoodRepo) GetFoodRecord(ctx context.Context, recordID string) (map[string]any, error) {
	var row map[string]any
	err := r.db.WithContext(ctx).Table("user_food_records").Where("id = ?", recordID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return row, err
}

func (r *PublicFoodRepo) GetTaskImagePaths(ctx context.Context, taskID string) ([]string, error) {
	var task analyzedomain.AnalysisTask
	err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return task.ImagePaths, err
}

func (r *PublicFoodRepo) CreateModerationTask(ctx context.Context, userID, itemID, text string) error {
	task := analyzedomain.AnalysisTask{
		ID:        uuid.New().String(),
		UserID:    userID,
		TaskType:  "public_food_library_text",
		Status:    "pending",
		TextInput: &text,
		Payload:   map[string]any{"item_id": itemID},
	}
	return r.db.WithContext(ctx).Create(&task).Error
}

func (r *PublicFoodRepo) Like(ctx context.Context, userID, itemID string) error {
	row := domain.PublicFoodLike{ID: uuid.New().String(), UserID: userID, LibraryItemID: itemID}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *PublicFoodRepo) Unlike(ctx context.Context, userID, itemID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND library_item_id = ?", userID, itemID).Delete(&domain.PublicFoodLike{}).Error
}

func (r *PublicFoodRepo) Collect(ctx context.Context, userID, itemID string) error {
	row := domain.PublicFoodCollection{ID: uuid.New().String(), UserID: userID, LibraryItemID: itemID}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *PublicFoodRepo) Uncollect(ctx context.Context, userID, itemID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND library_item_id = ?", userID, itemID).Delete(&domain.PublicFoodCollection{}).Error
}

func (r *PublicFoodRepo) SoftDeleteOwned(ctx context.Context, itemID, userID, status string) error {
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ? AND user_id = ?", itemID, userID).
		Updates(map[string]any{
			"status":     status,
			"updated_at": time.Now(),
		}).Error
}

func (r *PublicFoodRepo) ListComments(ctx context.Context, itemID string, limit int) ([]domain.PublicFoodComment, error) {
	var rows []domain.PublicFoodComment
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Table("public_food_library_comments AS c").
		Select("c.id, c.user_id, c.library_item_id, c.content, c.rating, c.created_at, COALESCE(u.nickname, '用户') AS nickname, COALESCE(u.avatar, '') AS avatar").
		Joins("LEFT JOIN weapp_user u ON u.id = c.user_id").
		Where("c.library_item_id = ?", itemID).
		Order("c.created_at desc").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) CreateComment(ctx context.Context, comment *domain.PublicFoodComment) error {
	if comment.ID == "" {
		comment.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *PublicFoodRepo) RefreshCommentStats(ctx context.Context, itemID string) error {
	type stats struct {
		Count int
		Avg   float64
	}
	var s stats
	if err := r.db.WithContext(ctx).Table("public_food_library_comments").
		Select("COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg").
		Where("library_item_id = ?", itemID).
		Scan(&s).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&domain.PublicFoodItem{}).Where("id = ?", itemID).Updates(map[string]any{
		"comment_count": s.Count,
		"avg_rating":    s.Avg,
	}).Error
}

func (r *PublicFoodRepo) CreateFeedback(ctx context.Context, feedback *domain.PublicFoodFeedback) error {
	if feedback.ID == "" {
		feedback.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(feedback).Error
}

func (r *PublicFoodRepo) LikeStatus(ctx context.Context, itemIDs []string, userID string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	var rows []domain.PublicFoodLike
	err := r.db.WithContext(ctx).Where("user_id = ? AND library_item_id IN ?", userID, itemIDs).Find(&rows).Error
	for _, row := range rows {
		out[row.LibraryItemID] = true
	}
	return out, err
}

func (r *PublicFoodRepo) CollectionStatus(ctx context.Context, itemIDs []string, userID string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	var rows []domain.PublicFoodCollection
	err := r.db.WithContext(ctx).Where("user_id = ? AND library_item_id IN ?", userID, itemIDs).Find(&rows).Error
	for _, row := range rows {
		out[row.LibraryItemID] = true
	}
	return out, err
}

func (r *PublicFoodRepo) Authors(ctx context.Context, userIDs []string) (map[string]domain.Author, error) {
	out := map[string]domain.Author{}
	if len(userIDs) == 0 {
		return out, nil
	}
	var users []authrepo.User
	err := r.db.WithContext(ctx).Where("id IN ?", uniqueNonEmpty(userIDs)).Find(&users).Error
	for _, u := range users {
		name := strings.TrimSpace(u.Nickname)
		if name == "" {
			name = "用户"
		}
		out[u.ID] = domain.Author{ID: u.ID, Nickname: name, Avatar: u.Avatar}
	}
	return out, err
}

func uniqueNonEmpty(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
