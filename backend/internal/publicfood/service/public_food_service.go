package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/storage"

	"gorm.io/datatypes"
)

type PublicFoodService struct {
	repo         *repo.PublicFoodRepo
	storage      *storage.Client
	taskQueue    taskqueue.Publisher
	analyzeTasks CampusAnalyzeTaskSubmitter
	rewards      RewardTaskAwarder
	blockChecker BlockChecker
}

type RewardTaskAwarder interface {
	AwardPublicFoodUpload(ctx context.Context, userID, publicFoodItemID string, meta map[string]any) (map[string]any, error)
}

type BlockChecker interface {
	IsBlockedEither(ctx context.Context, userA, userB string) (bool, error)
}

type CampusAnalyzeTaskSubmitter interface {
	SubmitAnalyzeTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
}

const (
	statusUserDeleted    = "user_deleted"
	statusDeleted        = "deleted"
	publicFoodTypeCommon = "common"
	publicFoodTypeCampus = "campus"
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

func (s *PublicFoodService) ConfigureCampusAnalyzeTaskSubmitter(submitter CampusAnalyzeTaskSubmitter) {
	s.analyzeTasks = submitter
}

func (s *PublicFoodService) ConfigureRewardTaskAwarder(awarder RewardTaskAwarder) {
	s.rewards = awarder
}

func (s *PublicFoodService) ConfigureBlockChecker(checker BlockChecker) {
	s.blockChecker = checker
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
	Type               string
	// Campus fields
	IsCampusFood       bool
	SchoolID           *string
	CampusID           *string
	CanteenID          *string
	WindowID           *string
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

type CommentInput struct {
	Content         string
	Rating          *int
	ParentCommentID *string
	ReplyToUserID   *string
}

func (s *PublicFoodService) Create(ctx context.Context, userID string, input CreateInput) (string, error) {
	normalizePublicFoodTypeInput(&input)
	if err := normalizePublicFoodLocationInput(&input); err != nil {
		return "", err
	}
	if err := s.applyCampusDirectoryRef(ctx, &input); err != nil {
		return "", err
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

	items := firstItems(input.Items, src)
	if items == nil {
		items = []map[string]any{}
	}
	userTags := input.UserTags
	if userTags == nil {
		userTags = []string{}
	}
	if imagePaths == nil {
		imagePaths = []string{}
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
		Items:              items,
		Description:        firstString(input.Description, src, "description"),
		Insight:            firstString(input.Insight, src, "insight"),
		FoodName:           ptrString(input.FoodName),
		MerchantName:       ptrString(input.MerchantName),
		MerchantAddress:    ptrString(input.MerchantAddress),
		TasteRating:        input.TasteRating,
		SuitableForFatLoss: input.SuitableForFatLoss,
		UserTags:           userTags,
		UserNotes:          ptrString(input.UserNotes),
		Latitude:           input.Latitude,
		Longitude:          input.Longitude,
		Province:           ptrString(input.Province),
		City:               ptrString(input.City),
		District:           ptrString(input.District),
		DetailAddress:      ptrString(input.DetailAddress),
		Status:             "pending",
		Type:               input.Type,
		IsCampusFood:       input.IsCampusFood,
		SchoolID:           trimPtr(input.SchoolID),
		CampusID:           trimPtr(input.CampusID),
		CanteenID:          trimPtr(input.CanteenID),
		WindowID:           trimPtr(input.WindowID),
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
	if isCampusPublicFood(item) {
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
	if isCampusPublicFood(item) {
		taskID, err := s.submitCampusAnalyzeTask(ctx, userID, item, firstPath, imagePaths)
		if err != nil {
			return "", err
		}
		if err := s.repo.LinkAnalysisTask(ctx, item.ID, taskID); err != nil {
			return "", err
		}
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

func (s *PublicFoodService) submitCampusAnalyzeTask(ctx context.Context, userID string, item *domain.PublicFoodItem, imageURL *string, imagePaths []string) (string, error) {
	payload := buildCampusAnalyzeExtraPayload(item)
	if s.analyzeTasks != nil {
		mode := "strict_separate"
		input := analyzeservice.SubmitTaskInput{
			ImageURLs:           imagePaths,
			ExecutionMode:       &mode,
			AdditionalContext:   stringFromAny(payload["additionalContext"]),
			SuggestRatioEnabled: true,
			SourceType:          "image",
			ExtraPayload:        payload,
		}
		if imageURL != nil {
			input.ImageURL = *imageURL
		}
		return s.analyzeTasks.SubmitAnalyzeTask(ctx, userID, input)
	}
	task, err := s.repo.CreateCampusAnalysisTask(ctx, userID, item.ID, imageURL, imagePaths, buildLegacyCampusAnalysisPayload(item, payload))
	if err != nil {
		return "", err
	}
	if err := s.enqueueTask(ctx, task.ID, task.TaskType); err != nil {
		return "", err
	}
	return task.ID, nil
}

func buildCampusAnalyzeExtraPayload(item *domain.PublicFoodItem) map[string]any {
	payload := map[string]any{
		"public_food_source_type": "campus_public_food",
		"public_food_item_id":     item.ID,
		"food_name":               item.FoodName,
		"school_name":             item.SchoolName,
		"campus_name":             item.CampusName,
		"canteen_name":            item.CanteenName,
		"floor":                   item.Floor,
		"window_name":             item.WindowName,
		"campus_location_text":    item.CampusLocationText,
	}
	contextParts := []string{}
	if item.FoodName != "" {
		contextParts = append(contextParts, "菜品名称："+item.FoodName)
	}
	if item.CampusLocationText != "" {
		contextParts = append(contextParts, "校园位置："+item.CampusLocationText)
	}
	if item.Price > 0 {
		contextParts = append(contextParts, fmt.Sprintf("价格：%.1f%s", item.Price, item.PriceUnit))
	}
	if item.PortionDescription != "" {
		contextParts = append(contextParts, "份量说明："+item.PortionDescription)
	}
	if item.UserNotes != "" {
		contextParts = append(contextParts, "用户备注："+item.UserNotes)
	}
	payload["additionalContext"] = strings.Join(contextParts, "；")
	payload["suggest_ratio_enabled"] = true
	return payload
}

func buildLegacyCampusAnalysisPayload(item *domain.PublicFoodItem, extra map[string]any) map[string]any {
	payload := map[string]any{}
	for key, value := range extra {
		payload[key] = value
	}
	payload["source_type"] = "campus_public_food"
	return payload
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "<nil>" {
		return ""
	}
	return text
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
	filter.ViewerUserID = userID
	items, err := s.repo.ListPublished(ctx, filter)
	if err != nil {
		return nil, err
	}
	items, err = s.filterVisibleItems(ctx, userID, items)
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
	items, err := s.repo.ListCollected(ctx, userID, 50, userID)
	if err != nil {
		return nil, err
	}
	items, err = s.filterVisibleItems(ctx, userID, items)
	if err != nil {
		return nil, err
	}
	return s.hydrate(ctx, userID, items, "")
}

func (s *PublicFoodService) UserCollectionsForViewer(ctx context.Context, viewerUserID, targetUserID string) ([]domain.PublicFoodView, error) {
	if err := s.ensureUserVisible(ctx, viewerUserID, targetUserID); err != nil {
		return nil, err
	}
	items, err := s.repo.ListCollected(ctx, targetUserID, 50, viewerUserID)
	if err != nil {
		return nil, err
	}
	items, err = s.filterVisibleItems(ctx, viewerUserID, items)
	if err != nil {
		return nil, err
	}
	return s.hydrate(ctx, viewerUserID, items, "")
}

func (s *PublicFoodService) Get(ctx context.Context, userID, itemID string) (*domain.PublicFoodView, error) {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil || isDeletedStatus(item.Status) {
		return nil, commonerrors.ErrNotFound
	}
	if err := s.ensureItemVisible(ctx, userID, item); err != nil {
		return nil, err
	}
	views, err := s.hydrate(ctx, userID, []domain.PublicFoodItem{*item}, "")
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

func (s *PublicFoodService) GetCampusDetail(ctx context.Context, userID, itemID string) (*domain.CampusFoodDetailView, error) {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil || isDeletedStatus(item.Status) || !isCampusPublicFood(item) {
		return nil, commonerrors.ErrNotFound
	}
	if err := s.ensureItemVisible(ctx, userID, item); err != nil {
		return nil, err
	}
	views, err := s.hydrate(ctx, userID, []domain.PublicFoodItem{*item}, "")
	if err != nil {
		return nil, err
	}
	similarItems, err := s.repo.ListSimilarCampusFoods(ctx, *item, 6, userID)
	if err != nil {
		return nil, err
	}
	similarItems, err = s.filterVisibleItems(ctx, userID, similarItems)
	if err != nil {
		return nil, err
	}
	similarViews, err := s.hydrate(ctx, userID, similarItems, "recommended")
	if err != nil {
		return nil, err
	}
	relatedFeeds, err := s.repo.ListRelatedCampusFeeds(ctx, *item, 6, userID)
	if err != nil {
		return nil, err
	}
	relatedFeeds, err = s.filterVisibleRelatedFeeds(ctx, userID, relatedFeeds)
	if err != nil {
		return nil, err
	}
	s.normalizeRelatedCampusFeeds(relatedFeeds)
	return &domain.CampusFoodDetailView{
		Item:         views[0],
		Metrics:      campusFoodMetrics(views[0].PublicFoodItem),
		SimilarItems: similarViews,
		RelatedFeeds: relatedFeeds,
	}, nil
}

func (s *PublicFoodService) Like(ctx context.Context, userID, itemID string) error {
	if err := s.ensureCanInteractWithItem(ctx, userID, itemID); err != nil {
		return err
	}
	return s.repo.Like(ctx, userID, itemID)
}

func (s *PublicFoodService) Unlike(ctx context.Context, userID, itemID string) error {
	return s.repo.Unlike(ctx, userID, itemID)
}

func (s *PublicFoodService) Collect(ctx context.Context, userID, itemID string) error {
	if err := s.ensureCanInteractWithItem(ctx, userID, itemID); err != nil {
		return err
	}
	return s.repo.Collect(ctx, userID, itemID)
}

func (s *PublicFoodService) Uncollect(ctx context.Context, userID, itemID string) error {
	return s.repo.Uncollect(ctx, userID, itemID)
}

func (s *PublicFoodService) Update(ctx context.Context, userID, itemID string, input CreateInput) error {
	normalizePublicFoodTypeInput(&input)
	if err := s.applyCampusDirectoryRef(ctx, &input); err != nil {
		return err
	}
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

	updates := map[string]any{
		"updated_at": time.Now(),
	}
	if input.ImagePath != nil && *input.ImagePath != "" {
		updates["image_path"] = *input.ImagePath
	}
	if len(input.ImagePaths) > 0 {
		b, _ := json.Marshal(input.ImagePaths)
		updates["image_paths"] = datatypes.JSON(b)
	}
	if input.FoodName != nil {
		updates["food_name"] = *input.FoodName
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Insight != nil {
		updates["insight"] = *input.Insight
	}
	if input.MerchantName != nil {
		updates["merchant_name"] = *input.MerchantName
	}
	if input.MerchantAddress != nil {
		updates["merchant_address"] = *input.MerchantAddress
	}
	if input.TasteRating != nil {
		updates["taste_rating"] = *input.TasteRating
	}
	updates["suitable_for_fat_loss"] = input.SuitableForFatLoss
	if input.UserTags != nil {
		b, _ := json.Marshal(input.UserTags)
		updates["user_tags"] = datatypes.JSON(b)
	}
	if input.UserNotes != nil {
		updates["user_notes"] = *input.UserNotes
	}
	if input.Latitude != nil {
		updates["latitude"] = *input.Latitude
	}
	if input.Longitude != nil {
		updates["longitude"] = *input.Longitude
	}
	if input.Province != nil {
		updates["province"] = *input.Province
	}
	if input.City != nil {
		updates["city"] = *input.City
	}
	if input.District != nil {
		updates["district"] = *input.District
	}
	if input.DetailAddress != nil {
		updates["detail_address"] = *input.DetailAddress
	}
	updates["type"] = input.Type
	updates["is_campus_food"] = input.IsCampusFood
	if input.Type == publicFoodTypeCampus {
		if input.SchoolID != nil {
			updates["school_id"] = strings.TrimSpace(*input.SchoolID)
		}
		if input.CampusID != nil {
			updates["campus_id"] = strings.TrimSpace(*input.CampusID)
		}
		if input.CanteenID != nil {
			updates["canteen_id"] = strings.TrimSpace(*input.CanteenID)
		}
		if input.WindowID != nil {
			updates["window_id"] = strings.TrimSpace(*input.WindowID)
		}
		if input.SchoolName != nil {
			updates["school_name"] = *input.SchoolName
		}
		if input.CampusName != nil {
			updates["campus_name"] = *input.CampusName
		}
		if input.CanteenName != nil {
			updates["canteen_name"] = *input.CanteenName
		}
		if input.Floor != nil {
			updates["floor"] = *input.Floor
		}
		if input.WindowName != nil {
			updates["window_name"] = *input.WindowName
		}
		if input.Price != nil {
			updates["price"] = *input.Price
		}
		if input.PriceType != nil {
			updates["price_type"] = *input.PriceType
		}
		if input.PriceMin != nil {
			updates["price_min"] = *input.PriceMin
		}
		if input.PriceMax != nil {
			updates["price_max"] = *input.PriceMax
		}
		if input.PriceUnit != nil {
			updates["price_unit"] = *input.PriceUnit
		}
		if input.PriceCollectedAt != nil {
			updates["price_collected_at"] = *input.PriceCollectedAt
		}
		if input.PortionDescription != nil {
			updates["portion_description"] = *input.PortionDescription
		}
		updates["campus_location_text"] = buildCampusLocationText(input.SchoolName, input.CampusName, input.CanteenName, input.Floor, input.WindowName)
	}

	return s.repo.UpdateItem(ctx, itemID, userID, updates)
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

func (s *PublicFoodService) Comments(ctx context.Context, userID, itemID string) ([]domain.PublicFoodComment, error) {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil || isDeletedStatus(item.Status) {
		return nil, commonerrors.ErrNotFound
	}
	if err := s.ensureItemVisible(ctx, userID, item); err != nil {
		return nil, err
	}
	comments, err := s.repo.ListComments(ctx, itemID, 50, userID)
	if err != nil {
		return nil, err
	}
	s.normalizePublicFoodComments(comments)
	return comments, nil
}

func (s *PublicFoodService) AddComment(ctx context.Context, userID, itemID string, input CommentInput) (*domain.PublicFoodComment, error) {
	if err := s.ensureCanInteractWithItem(ctx, userID, itemID); err != nil {
		return nil, err
	}
	content := strings.TrimSpace(input.Content)
	if content == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能为空", HTTPStatus: 400}
	}
	if len([]rune(content)) > 500 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能超过 500 字", HTTPStatus: 400}
	}
	if input.Rating != nil && (*input.Rating < 1 || *input.Rating > 5) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评分须为 1-5 的整数", HTTPStatus: 400}
	}
	parentCommentID := trimOptionalID(input.ParentCommentID)
	replyToUserID := trimOptionalID(input.ReplyToUserID)
	var rating *int
	if parentCommentID == nil {
		rating = input.Rating
	} else {
		parent, err := s.repo.GetComment(ctx, itemID, *parentCommentID)
		if err != nil {
			return nil, err
		}
		if parent == nil {
			return nil, commonerrors.ErrNotFound
		}
		if blocked, err := s.isBlockedEither(ctx, userID, parent.UserID); err != nil {
			return nil, err
		} else if blocked {
			return nil, blockedOperationError()
		}
		if parent.ParentCommentID != nil && strings.TrimSpace(*parent.ParentCommentID) != "" {
			parentCommentID = parent.ParentCommentID
		}
		if replyToUserID == nil {
			replyToUserID = &parent.UserID
		}
	}
	if replyToUserID != nil {
		if blocked, err := s.isBlockedEither(ctx, userID, *replyToUserID); err != nil {
			return nil, err
		} else if blocked {
			return nil, blockedOperationError()
		}
	}
	comment := &domain.PublicFoodComment{
		UserID:          userID,
		LibraryItemID:   itemID,
		ParentCommentID: parentCommentID,
		ReplyToUserID:   replyToUserID,
		Content:         content,
		Rating:          rating,
	}
	if err := s.repo.CreateComment(ctx, comment); err != nil {
		return nil, err
	}
	_ = s.repo.RefreshCommentStats(ctx, itemID)
	row, err := s.repo.GetComment(ctx, itemID, comment.ID)
	if err == nil && row != nil {
		rows := []domain.PublicFoodComment{*row}
		s.normalizePublicFoodComments(rows)
		return &rows[0], nil
	}
	return comment, nil
}

func (s *PublicFoodService) ensureUserVisible(ctx context.Context, viewerUserID, targetUserID string) error {
	blocked, err := s.isBlockedEither(ctx, viewerUserID, targetUserID)
	if err != nil {
		return err
	}
	if blocked {
		return commonerrors.ErrNotFound
	}
	return nil
}

func (s *PublicFoodService) ensureItemVisible(ctx context.Context, viewerUserID string, item *domain.PublicFoodItem) error {
	if item == nil {
		return commonerrors.ErrNotFound
	}
	return s.ensureUserVisible(ctx, viewerUserID, item.UserID)
}

func (s *PublicFoodService) ensureCanInteractWithItem(ctx context.Context, userID, itemID string) error {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return err
	}
	if item == nil || isDeletedStatus(item.Status) {
		return commonerrors.ErrNotFound
	}
	blocked, err := s.isBlockedEither(ctx, userID, item.UserID)
	if err != nil {
		return err
	}
	if blocked {
		return blockedOperationError()
	}
	return nil
}

func (s *PublicFoodService) filterVisibleItems(ctx context.Context, viewerUserID string, items []domain.PublicFoodItem) ([]domain.PublicFoodItem, error) {
	if s.blockChecker == nil || strings.TrimSpace(viewerUserID) == "" || len(items) == 0 {
		return items, nil
	}
	out := items[:0]
	for _, item := range items {
		blocked, err := s.isBlockedEither(ctx, viewerUserID, item.UserID)
		if err != nil {
			return nil, err
		}
		if !blocked {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *PublicFoodService) filterVisibleRelatedFeeds(ctx context.Context, viewerUserID string, feeds []domain.CampusRelatedFeedItem) ([]domain.CampusRelatedFeedItem, error) {
	if s.blockChecker == nil || strings.TrimSpace(viewerUserID) == "" || len(feeds) == 0 {
		return feeds, nil
	}
	out := feeds[:0]
	for _, feed := range feeds {
		blocked, err := s.isBlockedEither(ctx, viewerUserID, feed.UserID)
		if err != nil {
			return nil, err
		}
		if !blocked {
			out = append(out, feed)
		}
	}
	return out, nil
}

func (s *PublicFoodService) isBlockedEither(ctx context.Context, userA, userB string) (bool, error) {
	if s.blockChecker == nil || strings.TrimSpace(userA) == "" || strings.TrimSpace(userB) == "" || userA == userB {
		return false, nil
	}
	return s.blockChecker.IsBlockedEither(ctx, userA, userB)
}

func blockedOperationError() error {
	return &commonerrors.AppError{Code: 20003, Message: "无法操作", HTTPStatus: 403}
}

func (s *PublicFoodService) DeleteComment(ctx context.Context, userID, itemID, commentID string) error {
	rowsAffected, err := s.repo.DeleteOwnComment(ctx, itemID, commentID, userID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	_ = s.repo.RefreshCommentStats(ctx, itemID)
	return nil
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
	item.SchoolLogoURL = s.resolveSchoolLogoURL(item.SchoolLogoURL)
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
		if len(comments[i].Replies) > 0 {
			s.normalizePublicFoodComments(comments[i].Replies)
		}
	}
}

func (s *PublicFoodService) normalizeRelatedCampusFeeds(feeds []domain.CampusRelatedFeedItem) {
	for i := range feeds {
		feeds[i].ImagePaths = s.normalizeFoodImageURLs(feeds[i].ImagePaths)
		if len(feeds[i].ImagePaths) > 0 {
			first := feeds[i].ImagePaths[0]
			feeds[i].ImagePath = &first
			continue
		}
		if feeds[i].ImagePath != nil {
			resolved := s.resolveFoodImageURL(*feeds[i].ImagePath)
			if resolved == "" {
				feeds[i].ImagePath = nil
			} else {
				feeds[i].ImagePath = &resolved
				feeds[i].ImagePaths = []string{resolved}
			}
		}
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

func (s *PublicFoodService) resolveSchoolLogoURL(value string) string {
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

func campusFoodMetrics(item domain.PublicFoodItem) domain.CampusFoodMetric {
	price := metricPrice(item)
	metric := domain.CampusFoodMetric{}
	if price > 0 && item.TotalProtein > 0 {
		metric.ProteinPerYuan = math.Round(item.TotalProtein/price*10) / 10
	}
	if price > 0 && item.TotalCalories > 0 {
		metric.PricePer100Kcal = math.Round(price/item.TotalCalories*100*100) / 100
	}
	return metric
}

func metricPrice(item domain.PublicFoodItem) float64 {
	if item.Price > 0 {
		return item.Price
	}
	if item.PriceType == "range" && item.PriceMin > 0 && item.PriceMax > 0 {
		return (item.PriceMin + item.PriceMax) / 2
	}
	return 0
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

func trimOptionalID(v *string) *string {
	if v == nil {
		return nil
	}
	text := strings.TrimSpace(*v)
	if text == "" {
		return nil
	}
	return &text
}

func isDeletedStatus(status string) bool {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case statusUserDeleted, statusDeleted:
		return true
	default:
		return false
	}
}

func normalizePublicFoodTypeInput(input *CreateInput) {
	if input == nil {
		return
	}
	itemType := strings.TrimSpace(strings.ToLower(input.Type))
	if itemType == "" {
		if input.IsCampusFood {
			itemType = publicFoodTypeCampus
		} else {
			itemType = publicFoodTypeCommon
		}
	}
	switch itemType {
	case publicFoodTypeCampus:
		input.Type = publicFoodTypeCampus
		input.IsCampusFood = true
	default:
		input.Type = publicFoodTypeCommon
		input.IsCampusFood = false
	}
}

func isCampusPublicFood(item *domain.PublicFoodItem) bool {
	if item == nil {
		return false
	}
	return strings.TrimSpace(strings.ToLower(item.Type)) == publicFoodTypeCampus || item.IsCampusFood
}

func ptrFloat64(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func isHomemadeInput(input CreateInput) bool {
	for _, tag := range input.UserTags {
		if strings.TrimSpace(tag) == "自制" {
			return true
		}
	}
	return false
}

func normalizePublicFoodLocationInput(input *CreateInput) error {
	normalizePublicFoodTypeInput(input)
	if input == nil || input.Type == publicFoodTypeCampus {
		return nil
	}
	clearCampusPriceInput(input)
	if isHomemadeInput(*input) {
		input.MerchantName = nil
		input.MerchantAddress = nil
		input.DetailAddress = nil
		input.District = nil
		input.Latitude = nil
		input.Longitude = nil
		return nil
	}
	if strings.TrimSpace(ptrString(input.Province)) == "" ||
		strings.TrimSpace(ptrString(input.City)) == "" ||
		strings.TrimSpace(ptrString(input.District)) == "" ||
		input.Latitude == nil || input.Longitude == nil {
		return &commonerrors.AppError{Code: 10002, Message: "公共食物库上传必须带完整地理位置", HTTPStatus: 400}
	}
	return nil
}

func (s *PublicFoodService) applyCampusDirectoryRef(ctx context.Context, input *CreateInput) error {
	if input == nil {
		return nil
	}
	normalizePublicFoodTypeInput(input)
	if input.Type != publicFoodTypeCampus {
		return nil
	}
	ref, err := s.repo.GetCampusDirectoryRef(ctx, ptrString(input.SchoolID), ptrString(input.CampusID), ptrString(input.CanteenID), ptrString(input.WindowID))
	if err != nil {
		return err
	}
	if ref == nil {
		if input.SchoolID != nil || input.CampusID != nil || input.CanteenID != nil || input.WindowID != nil {
			return &commonerrors.AppError{Code: 10002, Message: "请选择已审核的校园食堂", HTTPStatus: 400}
		}
		return nil
	}
	if ref.SchoolID != "" {
		input.SchoolID = strPtr(ref.SchoolID)
		input.SchoolName = strPtr(ref.SchoolName)
	}
	if ref.CampusID != "" {
		input.CampusID = strPtr(ref.CampusID)
	}
	if ref.CampusName != "" {
		input.CampusName = strPtr(ref.CampusName)
	}
	if ref.CanteenID != "" {
		input.CanteenID = strPtr(ref.CanteenID)
	}
	if ref.CanteenName != "" {
		input.CanteenName = strPtr(ref.CanteenName)
	}
	if ref.WindowID != "" {
		input.WindowID = strPtr(ref.WindowID)
	}
	if ref.WindowName != "" {
		input.WindowName = strPtr(ref.WindowName)
	}
	if ref.Floor != "" && input.Floor == nil {
		input.Floor = strPtr(ref.Floor)
	}
	return nil
}

func clearCampusPriceInput(input *CreateInput) {
	input.Price = nil
	input.PriceType = nil
	input.PriceMin = nil
	input.PriceMax = nil
	input.PriceUnit = nil
	input.PriceCollectedAt = nil
	input.PortionDescription = nil
}

func trimPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func strPtr(value string) *string {
	return &value
}

func validateCampusCreateInput(input CreateInput, imagePaths []string) error {
	normalizePublicFoodTypeInput(&input)
	if input.Type != publicFoodTypeCampus {
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
