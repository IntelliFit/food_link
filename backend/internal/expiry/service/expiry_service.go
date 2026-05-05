package service

import (
	"context"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/repo"
)

type ExpiryService struct {
	expiryRepo *repo.ExpiryRepo
	taskRepo   *repo.TaskRepo
}

func NewExpiryService(expiryRepo *repo.ExpiryRepo, taskRepo *repo.TaskRepo) *ExpiryService {
	return &ExpiryService{expiryRepo: expiryRepo, taskRepo: taskRepo}
}

type DashboardResult struct {
	ActiveCount   int                `json:"active_count"`
	ConsumedCount int                `json:"consumed_count"`
	ExpiredCount  int                `json:"expired_count"`
	ExpiringSoon  []domain.ExpiryItem `json:"expiring_soon"`
}

type CreateItemInput struct {
	Name       string
	Category   string
	ExpiryDate *time.Time
	Quantity   *int
	Location   *string
	Notes      *string
	ImageURL   *string
	Status     string
}

type UpdateItemInput struct {
	Name       *string
	Category   *string
	ExpiryDate *time.Time
	Quantity   *int
	Location   *string
	Notes      *string
	ImageURL   *string
	Status     *string
}

type SubscribeResult struct {
	Subscribed bool   `json:"subscribed"`
	Message    string `json:"message"`
}

type RecognizeResult struct {
	TaskID  string `json:"task_id"`
	Message string `json:"message"`
}

func (s *ExpiryService) Dashboard(ctx context.Context, userID string) (*DashboardResult, error) {
	counts, err := s.expiryRepo.CountByStatus(ctx, userID)
	if err != nil {
		return nil, err
	}
	expiringSoon, err := s.expiryRepo.ListExpiringSoon(ctx, userID, 7, 50)
	if err != nil {
		return nil, err
	}
	return &DashboardResult{
		ActiveCount:   counts["active"],
		ConsumedCount: counts["consumed"],
		ExpiredCount:  counts["expired"],
		ExpiringSoon:  expiringSoon,
	}, nil
}

func (s *ExpiryService) ListItems(ctx context.Context, userID, status string) ([]domain.ExpiryItem, error) {
	return s.expiryRepo.ListByUser(ctx, userID, status, 200)
}

func (s *ExpiryService) CreateItem(ctx context.Context, userID string, input CreateItemInput) (*domain.ExpiryItem, error) {
	if input.Name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
	}
	status := input.Status
	if status == "" {
		status = "active"
	}
	item := &domain.ExpiryItem{
		UserID:     userID,
		Name:       input.Name,
		Category:   input.Category,
		ExpiryDate: input.ExpiryDate,
		Quantity:   input.Quantity,
		Location:   input.Location,
		Notes:      input.Notes,
		ImageURL:   input.ImageURL,
		Status:     status,
	}
	if err := s.expiryRepo.Create(ctx, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *ExpiryService) GetItem(ctx context.Context, userID, itemID string) (*domain.ExpiryItem, error) {
	item, err := s.expiryRepo.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	if item.UserID != userID {
		return nil, commonerrors.ErrForbidden
	}
	return item, nil
}

func (s *ExpiryService) UpdateItem(ctx context.Context, userID, itemID string, input UpdateItemInput) (*domain.ExpiryItem, error) {
	updates := map[string]any{}
	if input.Name != nil {
		if *input.Name == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
		}
		updates["name"] = *input.Name
	}
	if input.Category != nil {
		updates["category"] = *input.Category
	}
	if input.ExpiryDate != nil {
		updates["expiry_date"] = *input.ExpiryDate
	}
	if input.Quantity != nil {
		updates["quantity"] = *input.Quantity
	}
	if input.Location != nil {
		updates["location"] = *input.Location
	}
	if input.Notes != nil {
		updates["notes"] = *input.Notes
	}
	if input.ImageURL != nil {
		updates["image_url"] = *input.ImageURL
	}
	if input.Status != nil {
		updates["status"] = *input.Status
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有需要更新的字段", HTTPStatus: 400}
	}
	item, err := s.expiryRepo.Update(ctx, userID, itemID, updates)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	return item, nil
}

func (s *ExpiryService) UpdateStatus(ctx context.Context, userID, itemID, status string) (*domain.ExpiryItem, error) {
	if status == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "status 不能为空", HTTPStatus: 400}
	}
	item, err := s.expiryRepo.Update(ctx, userID, itemID, map[string]any{"status": status})
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	return item, nil
}

func (s *ExpiryService) Subscribe(ctx context.Context, userID, itemID string) (*SubscribeResult, error) {
	item, err := s.expiryRepo.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	if item.UserID != userID {
		return nil, commonerrors.ErrForbidden
	}
	return &SubscribeResult{
		Subscribed: true,
		Message:    "订阅成功",
	}, nil
}

func (s *ExpiryService) Recognize(ctx context.Context, userID string, imageURLs []string) (*RecognizeResult, error) {
	if len(imageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请至少提供 1 张图片", HTTPStatus: 400}
	}
	task, err := s.taskRepo.CreateExpiryRecognizeTask(ctx, userID, imageURLs)
	if err != nil {
		return nil, err
	}
	return &RecognizeResult{
		TaskID:  task.ID,
		Message: "识别任务已创建",
	}, nil
}
