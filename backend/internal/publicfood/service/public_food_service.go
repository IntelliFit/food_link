package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/storage"
)

type PublicFoodService struct {
	repo      *repo.PublicFoodRepo
	storage   *storage.Client
	taskQueue taskqueue.Publisher
	rewards   RewardTaskAwarder
}

type RewardTaskAwarder interface {
	AwardPublicFoodUpload(ctx context.Context, userID, publicFoodItemID string, meta map[string]any) (map[string]any, error)
}

const (
	statusUserDeleted = "user_deleted"
	statusDeleted     = "deleted"
)

func NewPublicFoodService(repo *repo.PublicFoodRepo, storageClient ...*storage.Client) *PublicFoodService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &PublicFoodService{repo: repo, storage: client}
}

func (s *PublicFoodService) ConfigureTaskPublisher(queue taskqueue.Publisher) {
	s.taskQueue = queue
}

func (s *PublicFoodService) ConfigureRewardTaskAwarder(awarder RewardTaskAwarder) {
	s.rewards = awarder
}

type CreateInput struct {
	ImagePath          *string
	ImagePaths         []string
	SourceRecordID     *string
	TotalCalories      float64
	TotalProtein       float64
	TotalCarbs         float64
	TotalFat           float64
	Items              []map[string]any
	Description        *string
	Insight            *string
	FoodName           *string
	MerchantName       *string
	MerchantAddress    *string
	TasteRating        *int
	SuitableForFatLoss bool
	UserTags           []string
	UserNotes          *string
	Latitude           *float64
	Longitude          *float64
	Province           *string
	City               *string
	District           *string
	DetailAddress      *string
	// Campus fields
	IsCampusFood       bool
	SchoolName         *string
	CampusName         *string
	CanteenName        *string
	Floor              *string
	WindowName         *string
	Price              *float64
	PriceType          *string
	PriceMin           *float64
	PriceMax           *float64
	PriceUnit          *string
	PriceCollectedAt   *time.Time
	PortionDescription *string
}

func (s *PublicFoodService) Create(ctx context.Context, userID string, input CreateInput) (string, error) {
	if !input.IsCampusFood {
		if strings.TrimSpace(ptrString(input.Province)) == "" ||
			strings.TrimSpace(ptrString(input.City)) == "" ||
			strings.TrimSpace(ptrString(input.District)) == "" ||
			input.Latitude == nil || input.Longitude == nil {
			return "", &commonerrors.AppError{Code: 10002, Message: "公共食物库上传必须带完整地理位置", HTTPStatus: 400}
		}
	}
	var src map[string]any
	var err error
	if input.SourceRecordID != nil && *input.SourceRecordID != "" {
		src, err = s.repo.GetFoodRecord(ctx, *input.SourceRecordID)
		if err != nil {
			return "", err
		}
		if src == nil {
			return "", commonerrors.ErrNotFound
		}
		if fmt.Sprint(src["user_id"]) != userID {
			return "", commonerrors.ErrForbidden
		}
	}

	imagePaths := input.ImagePaths
	if len(imagePaths) == 0 && src != nil {
		if taskID := fmt.Sprint(src["source_task_id"]); taskID != "" && taskID != "<nil>" {
			paths, _ := s.repo.GetTaskImagePaths(ctx, taskID)
			imagePaths = append(imagePaths, paths...)
		}
	}
	if len(imagePaths) == 0 {
		if input.ImagePath != nil && *input.ImagePath != "" {
			imagePaths = append(imagePaths, *input.ImagePath)
		} else if src != nil {
			if p := fmt.Sprint(src["image_path"]); p != "" && p != "<nil>" {
				imagePaths = append(imagePaths, p)
			}
		}
	}
	imagePaths = s.normalizeFoodImageURLs(imagePaths)
	if err := validateCampusCreateInput(input, imagePaths); err != nil {
		return "", err
	}

	firstPath := input.ImagePath
	if len(imagePaths) > 0 {
		first := imagePaths[0]
		firstPath = &first
	} else if firstPath != nil {
		resolved := s.resolveFoodImageURL(*firstPath)
		if resolved == "" {
			firstPath = nil
		} else {
			firstPath = &resolved
		}
	}

	item := &domain.PublicFoodItem{
		UserID:             userID,
		SourceRecordID:     input.SourceRecordID,
		ImagePath:          firstPath,
		ImagePaths:         imagePaths,
		TotalCalories:      firstFloat(input.TotalCalories, src, "total_calories"),
		TotalProtein:       firstFloat(input.TotalProtein, src, "total_protein"),
		TotalCarbs:         firstFloat(input.TotalCarbs, src, "total_carbs"),
		TotalFat:           firstFloat(input.TotalFat, src, "total_fat"),
		Items:              firstItems(input.Items, src),
		Description:        firstString(input.Description, src, "description"),
		Insight:            firstString(input.Insight, src, "insight"),
		FoodName:           ptrString(input.FoodName),
		MerchantName:       ptrString(input.MerchantName),
		MerchantAddress:    ptrString(input.MerchantAddress),
		TasteRating:        input.TasteRating,
		SuitableForFatLoss: input.SuitableForFatLoss,
		UserTags:           input.UserTags,
		UserNotes:          ptrString(input.UserNotes),
		Latitude:           input.Latitude,
		Longitude:          input.Longitude,
		Province:           ptrString(input.Province),
		City:               ptrString(input.City),
		District:           ptrString(input.District),
		DetailAddress:      ptrString(input.DetailAddress),
		Status:             "pending",
		IsCampusFood:       input.IsCampusFood,
		SchoolName:         ptrString(input.SchoolName),
		CampusName:         ptrString(input.CampusName),
		CanteenName:        ptrString(input.CanteenName),
		Floor:              ptrString(input.Floor),
		WindowName:         ptrString(input.WindowName),
		Price:              ptrFloat64(input.Price),
		PriceType:          ptrString(input.PriceType),
		PriceMin:           ptrFloat64(input.PriceMin),
		PriceMax:           ptrFloat64(input.PriceMax),
		PriceUnit:          ptrString(input.PriceUnit),
		PriceCollectedAt:   input.PriceCollectedAt,
		PortionDescription: ptrString(input.PortionDescription),
		CampusLocationText: buildCampusLocationText(input.SchoolName, input.CampusName, input.CanteenName, input.Floor, input.WindowName),
	}
	if item.IsCampusFood {
		item.Status = "published"
		now := time.Now()
		item.PublishedAt = &now
		if item.PriceCollectedAt == nil && hasCampusPrice(item) {
			item.PriceCollectedAt = &now
		}
	}
	if err := s.repo.CreateItem(ctx, item); err != nil {
		return "", err
	}
	if item.IsCampusFood {
		if s.rewards != nil {
			_, _ = s.rewards.AwardPublicFoodUpload(ctx, userID, item.ID, map[string]any{
				"public_food_item_id": item.ID,
				"food_name":           item.FoodName,
				"merchant_name":       item.MerchantName,
				"is_campus_food":      true,
				"school_name":         item.SchoolName,
				"canteen_name":        item.CanteenName,
			})
		}
		return item.ID, nil
	}
	text := strings.TrimSpace(strings.Join([]string{
		item.FoodName, item.MerchantName, item.MerchantAddress, item.Description, item.Insight, item.UserNotes,
	}, " "))
	if text != "" {
		task, err := s.repo.CreateModerationTask(ctx, userID, item.ID, text)
		if err != nil {
			return "", err
		}
		if err := s.enqueueTask(ctx, task.ID, task.TaskType); err != nil {
			return "", err
		}
	} else if err := s.repo.UpdateStatus(ctx, item.ID, "published"); err != nil {
		return "", err
	}
	if s.rewards != nil {
		_, _ = s.rewards.AwardPublicFoodUpload(ctx, userID, item.ID, map[string]any{
			"public_food_item_id": item.ID,
			"food_name":           item.FoodName,
			"merchant_name":       item.MerchantName,
		})
	}
	return item.ID, nil
}

func (s *PublicFoodService) enqueueTask(ctx context.Context, taskID, taskType string) error {
	if s.taskQueue == nil || strings.TrimSpace(taskID) == "" || strings.TrimSpace(taskType) == "" {
		return nil
	}
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.taskQueue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: taskID, TaskType: taskType}); err != nil {
		return fmt.Errorf("enqueue public food moderation task: %w", err)
	}
	return nil
}

func (s *PublicFoodService) List(ctx context.Context, userID string, filter repo.ListFilter) ([]domain.PublicFoodView, error) {
	items, err := s.repo.ListPublished(ctx, filter)
	if err != nil {
		return nil, err
	}
	return s.hydrate(ctx, userID, items, filter.SortBy)
}

func (s *PublicFoodService) Mine(ctx context.Context, userID string) ([]domain.PublicFoodItem, error) {
	items, err := s.repo.ListMine(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	return s.normalizePublicFoodItems(items), nil
}

func (s *PublicFoodService) Collections(ctx context.Context, userID string) ([]domain.PublicFoodView, error) {
	items, err := s.repo.ListCollected(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	return s.hydrate(ctx, userID, items, "")
}

func (s *PublicFoodService) Get(ctx context.Context, userID, itemID string) (*domain.PublicFoodView, error) {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil || isDeletedStatus(item.Status) {
		return nil, commonerrors.ErrNotFound
	}
	views, err := s.hydrate(ctx, userID, []domain.PublicFoodItem{*item}, "")
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

func (s *PublicFoodService) Like(ctx context.Context, userID, itemID string) error {
	return s.repo.Like(ctx, userID, itemID)
}

func (s *PublicFoodService) Unlike(ctx context.Context, userID, itemID string) error {
	return s.repo.Unlike(ctx, userID, itemID)
}

func (s *PublicFoodService) Collect(ctx context.Context, userID, itemID string) error {
	return s.repo.Collect(ctx, userID, itemID)
}

func (s *PublicFoodService) Uncollect(ctx context.Context, userID, itemID string) error {
	return s.repo.Uncollect(ctx, userID, itemID)
}

func (s *PublicFoodService) Delete(ctx context.Context, userID, itemID string) error {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return err
	}
	if item == nil || isDeletedStatus(item.Status) {
		return commonerrors.ErrNotFound
	}
	if item.UserID != userID {
		return commonerrors.ErrForbidden
	}
	return s.repo.SoftDeleteOwned(ctx, itemID, userID, statusUserDeleted)
}

func (s *PublicFoodService) Comments(ctx context.Context, itemID string) ([]domain.PublicFoodComment, error) {
	comments, err := s.repo.ListComments(ctx, itemID, 50)
	if err != nil {
		return nil, err
	}
	s.normalizePublicFoodComments(comments)
	return comments, nil
}

func (s *PublicFoodService) AddComment(ctx context.Context, userID, itemID, content string, rating *int) (*domain.PublicFoodComment, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能为空", HTTPStatus: 400}
	}
	if len([]rune(content)) > 500 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能超过 500 字", HTTPStatus: 400}
	}
	if rating != nil && (*rating < 1 || *rating > 5) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评分须为 1-5 的整数", HTTPStatus: 400}
	}
	comment := &domain.PublicFoodComment{
		UserID:        userID,
		LibraryItemID: itemID,
		Content:       content,
		Rating:        rating,
	}
	if err := s.repo.CreateComment(ctx, comment); err != nil {
		return nil, err
	}
	_ = s.repo.RefreshCommentStats(ctx, itemID)
	rows, err := s.repo.ListComments(ctx, itemID, 1)
	if err == nil {
		s.normalizePublicFoodComments(rows)
		for _, row := range rows {
			if row.ID == comment.ID {
				return &row, nil
			}
		}
	}
	return comment, nil
}

func (s *PublicFoodService) Feedback(ctx context.Context, userID, content string, itemID *string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "反馈内容不能为空", HTTPStatus: 400}
	}
	if len([]rune(content)) > 1000 {
		return "", &commonerrors.AppError{Code: 10002, Message: "反馈内容不能超过 1000 字", HTTPStatus: 400}
	}
	row := &domain.PublicFoodFeedback{UserID: userID, Content: content, LibraryItemID: itemID}
	if err := s.repo.CreateFeedback(ctx, row); err != nil {
		return "", err
	}
	return row.ID, nil
}

func (s *PublicFoodService) hydrate(ctx context.Context, userID string, items []domain.PublicFoodItem, sortBy string) ([]domain.PublicFoodView, error) {
	itemIDs := make([]string, 0, len(items))
	userIDs := make([]string, 0, len(items))
	for _, it := range items {
		itemIDs = append(itemIDs, it.ID)
		userIDs = append(userIDs, it.UserID)
	}
	likes, err := s.repo.LikeStatus(ctx, itemIDs, userID)
	if err != nil {
		return nil, err
	}
	collections, err := s.repo.CollectionStatus(ctx, itemIDs, userID)
	if err != nil {
		return nil, err
	}
	authors, err := s.repo.Authors(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	out := make([]domain.PublicFoodView, 0, len(items))
	for _, it := range items {
		item := s.normalizePublicFoodItem(it)
		author := authors[it.UserID]
		if author.Nickname == "" {
			author = domain.Author{ID: it.UserID, Nickname: "用户"}
		}
		author.Avatar = s.resolveAvatarURL(author.Avatar)
		out = append(out, domain.PublicFoodView{
			PublicFoodItem:  item,
			Liked:           likes[it.ID],
			Collected:       collections[it.ID],
			Author:          author,
			RecommendReason: recommendReason(item, sortBy),
		})
	}
	return out, nil
}

func (s *PublicFoodService) normalizePublicFoodItems(items []domain.PublicFoodItem) []domain.PublicFoodItem {
	for i := range items {
		items[i] = s.normalizePublicFoodItem(items[i])
	}
	return items
}

func (s *PublicFoodService) normalizePublicFoodItem(item domain.PublicFoodItem) domain.PublicFoodItem {
	item.ImagePaths = s.normalizeFoodImageURLs(item.ImagePaths)
	if len(item.ImagePaths) > 0 {
		first := item.ImagePaths[0]
		item.ImagePath = &first
		return item
	}
	if item.ImagePath != nil {
		resolved := s.resolveFoodImageURL(*item.ImagePath)
		if resolved == "" {
			item.ImagePath = nil
		} else {
			item.ImagePath = &resolved
			item.ImagePaths = []string{resolved}
		}
	}
	return item
}

func (s *PublicFoodService) normalizePublicFoodComments(comments []domain.PublicFoodComment) {
	for i := range comments {
		comments[i].Avatar = s.resolveAvatarURL(comments[i].Avatar)
	}
}

func (s *PublicFoodService) normalizeFoodImageURLs(values []string) []string {
	if s.storage != nil {
		return s.storage.ResolveReferenceURLs("food-images", values)
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *PublicFoodService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *PublicFoodService) resolveAvatarURL(value string) string {
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

func recommendReason(item domain.PublicFoodItem, sortBy string) string {
	switch sortBy {
	case "high_protein":
		return fmt.Sprintf("蛋白质约 %.0fg", item.TotalProtein)
	case "low_calorie":
		return fmt.Sprintf("热量约 %.0fkcal", item.TotalCalories)
	case "balanced", "recommended":
		total := item.TotalProtein*4 + item.TotalCarbs*4 + item.TotalFat*9
		if total <= 0 {
			return ""
		}
		p := math.Round(item.TotalProtein * 4 / total * 100)
		return fmt.Sprintf("蛋白质供能约 %.0f%%", p)
	default:
		return ""
	}
}

func firstFloat(v float64, src map[string]any, key string) float64 {
	if v != 0 || src == nil {
		return v
	}
	switch raw := src[key].(type) {
	case float64:
		return raw
	case int64:
		return float64(raw)
	case int:
		return float64(raw)
	default:
		return 0
	}
}

func firstString(v *string, src map[string]any, key string) string {
	if v != nil {
		return *v
	}
	if src == nil {
		return ""
	}
	if raw, ok := src[key].(string); ok {
		return raw
	}
	return ""
}

func firstItems(items []map[string]any, src map[string]any) []map[string]any {
	if len(items) > 0 || src == nil {
		return items
	}
	if raw, ok := src["items"].([]map[string]any); ok {
		return raw
	}
	if raw, ok := src["items"].([]any); ok {
		out := make([]map[string]any, 0, len(raw))
		for _, it := range raw {
			if m, ok := it.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func ptrString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func isDeletedStatus(status string) bool {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case statusUserDeleted, statusDeleted:
		return true
	default:
		return false
	}
}

func ptrFloat64(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func validateCampusCreateInput(input CreateInput, imagePaths []string) error {
	if !input.IsCampusFood {
		return nil
	}
	if strings.TrimSpace(ptrString(input.FoodName)) == "" {
		return &commonerrors.AppError{Code: 10002, Message: "请填写校园菜品名称", HTTPStatus: 400}
	}
	if strings.TrimSpace(ptrString(input.SchoolName)) == "" {
		return &commonerrors.AppError{Code: 10002, Message: "请选择学校", HTTPStatus: 400}
	}
	if strings.TrimSpace(ptrString(input.CanteenName)) == "" {
		return &commonerrors.AppError{Code: 10002, Message: "请填写食堂名称", HTTPStatus: 400}
	}
	if len(imagePaths) == 0 {
		return &commonerrors.AppError{Code: 10002, Message: "请上传校园菜品图片", HTTPStatus: 400}
	}
	priceType := strings.TrimSpace(ptrString(input.PriceType))
	if priceType == "" {
		return nil
	}
	switch priceType {
	case "fixed", "weight", "range", "combo", "unknown":
	default:
		return &commonerrors.AppError{Code: 10002, Message: "计价方式不正确", HTTPStatus: 400}
	}
	if priceType == "range" {
		if input.PriceMin == nil || input.PriceMax == nil || *input.PriceMin <= 0 || *input.PriceMax <= 0 || *input.PriceMin > *input.PriceMax {
			return &commonerrors.AppError{Code: 10002, Message: "请填写正确的价格区间", HTTPStatus: 400}
		}
	}
	return nil
}

func hasCampusPrice(item *domain.PublicFoodItem) bool {
	if item == nil {
		return false
	}
	return item.Price > 0 || item.PriceMin > 0 || item.PriceMax > 0
}

func buildCampusLocationText(school, campus, canteen, floor, window *string) string {
	parts := []string{}
	if school != nil && *school != "" {
		parts = append(parts, *school)
	}
	if campus != nil && *campus != "" {
		parts = append(parts, *campus)
	}
	if canteen != nil && *canteen != "" {
		parts = append(parts, *canteen)
	}
	if floor != nil && *floor != "" {
		parts = append(parts, *floor)
	}
	if window != nil && *window != "" {
		parts = append(parts, *window)
	}
	return strings.Join(parts, " · ")
}
