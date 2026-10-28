// Package service runs the "which canteen dish was this meal" prompt shown
// while a photo is recognised: suggest canteens, rank the chosen canteen's
// dishes, record the answer and, when a dish has no real photo yet, take the
// user's photo for it with consent.
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
)

const (
	recentWindow       = 60 * 24 * time.Hour
	nearbyRadiusM      = 800.0
	maxMenuRows        = 1000
	dishesPerWindow    = 12
	maxSampleAccuracyM = 100.0
	geocodeTimeout     = 2500 * time.Millisecond
	confidentScore     = 0.6
)

type Repository interface {
	CreatePrompt(ctx context.Context, prompt *domain.Prompt) (*domain.Prompt, error)
	PromptByTask(ctx context.Context, userID, taskID string) (*domain.Prompt, error)
	PromptByID(ctx context.Context, userID, id string) (*domain.Prompt, error)
	UpdatePrompt(ctx context.Context, userID, id string, updates map[string]any) error
	AddLocationSample(ctx context.Context, sample *domain.LocationSample) error
	RecentCanteens(ctx context.Context, userID string, since time.Time, limit int) ([]domain.Canteen, error)
	CanteensNear(ctx context.Context, lat, lng, radiusM float64, limit int) ([]domain.Canteen, error)
	SchoolCanteensFromAddress(ctx context.Context, texts []string, limit int) ([]domain.Canteen, error)
	CanteenByID(ctx context.Context, id string) (*domain.Canteen, error)
	CanteenDishes(ctx context.Context, canteenID string, limit int) ([]repo.DishRow, error)
	DishByID(ctx context.Context, id string) (*repo.DishRow, error)
	TaskForUser(ctx context.Context, userID, taskID string) (*repo.Task, error)
	UserSignals(ctx context.Context, userID string, recordSince, promptSince time.Time) (repo.UserSignals, error)
	PriceAsks(ctx context.Context, userID string, dayStart time.Time, limit int) ([]repo.PriceAsk, int, error)
	PriceAgreement(ctx context.Context, itemID string, price float64, since time.Time) (int, error)
}

// Geocoder turns a position into address text (the location service).
type Geocoder interface {
	ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error)
}

// PhotoContributor appends the user's photo to a canteen dish (the campus
// catalog's versioned image contribution).
type PhotoContributor interface {
	ContributeDishPhoto(ctx context.Context, userID, itemID string, imagePaths []string) error
}

// RewardAwarder grants the existing "上传公共餐食" credit, once per dish.
type RewardAwarder interface {
	AwardPublicFoodUpload(ctx context.Context, userID, publicFoodItemID string, meta map[string]any) (map[string]any, error)
}

// PublicationChecker runs the platform content check before a photo goes public.
type PublicationChecker interface {
	CheckPublication(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error
}

type Service struct {
	repo        Repository
	storage     *storage.Client
	geocoder    Geocoder
	contributor PhotoContributor
	rewards     RewardAwarder
	publication PublicationChecker
	prices      PriceCorrector
	now         func() time.Time
}

type Deps struct {
	Repo        Repository
	Storage     *storage.Client
	Geocoder    Geocoder
	Contributor PhotoContributor
	Rewards     RewardAwarder
	Publication PublicationChecker
	Prices      PriceCorrector
}

func New(deps Deps) *Service {
	return &Service{repo: deps.Repo, storage: deps.Storage, geocoder: deps.Geocoder, contributor: deps.Contributor,
		rewards: deps.Rewards, publication: deps.Publication, prices: deps.Prices, now: time.Now}
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

// StartInput opens the prompt for a recognition task. The position is only
// sent when the user already granted location; it is never stored on the row.
type StartInput struct {
	TaskID         string   `json:"task_id"`
	Surface        string   `json:"surface"`
	LocationStatus string   `json:"location_status"`
	Latitude       *float64 `json:"latitude"`
	Longitude      *float64 `json:"longitude"`
	// Force opens the prompt with no suggestion, for a user who will pick
	// the canteen from the directory themselves.
	Force bool `json:"force"`
	// RecommendedItemID is the canteen dish the home card recommended shortly
	// before the photo; RecommendedKind says whether the user navigated to
	// it, asked about it, or only saw it.
	RecommendedItemID string `json:"recommended_item_id"`
	RecommendedKind   string `json:"recommended_kind"`
}

type DishView struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	WindowName   string `json:"window_name"`
	PriceText    string `json:"price_text"`
	ImageURL     string `json:"image_url,omitempty"`
	HasRealPhoto bool   `json:"has_real_photo"`
	CanteenID    string `json:"canteen_id,omitempty"`
	CanteenName  string `json:"canteen_name,omitempty"`
}

// PromptView is what the waiting and result pages render.
type PromptView struct {
	Eligible       bool             `json:"eligible"`
	Prompt         *domain.Prompt   `json:"prompt,omitempty"`
	Canteens       []domain.Canteen `json:"canteens"`
	ChosenCanteen  *domain.Canteen  `json:"chosen_canteen,omitempty"`
	ChosenDish     *DishView        `json:"chosen_dish,omitempty"`
	Candidates     []domain.Dish    `json:"candidates,omitempty"`
	CandidatesFrom *domain.Canteen  `json:"candidates_from,omitempty"`
	// RecommendedDish is offered as a one-tap answer before the canteen step.
	RecommendedDish *DishView `json:"recommended_dish,omitempty"`
	// PriceAsk is set while the price question waits for an answer.
	PriceAsk *PriceAsk `json:"price_ask,omitempty"`
}

// StartPrompt suggests up to three canteens: ones near the user's position,
// ones the user confirmed recently, then the canteens of the university the
// address names. No suggestion means no prompt (the page keeps its quiz).
func (s *Service) StartPrompt(ctx context.Context, userID string, input StartInput) (*PromptView, error) {
	userID, taskID := strings.TrimSpace(userID), strings.TrimSpace(input.TaskID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	task, err := s.repo.TaskForUser(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, commonerrors.ErrNotFound
	}
	if existing, err := s.repo.PromptByTask(ctx, userID, taskID); err != nil {
		return nil, err
	} else if existing != nil {
		return s.view(ctx, existing, task)
	}
	located := input.Latitude != nil && input.Longitude != nil && validCoordinate(*input.Latitude, *input.Longitude)
	sources := []string{}
	var recommended, nearby, school []domain.Canteen
	recommendedCanteen, recommendedDish := s.recommendedSuggestion(ctx, input)
	if recommendedCanteen != nil {
		recommended = []domain.Canteen{*recommendedCanteen}
	}
	if located {
		nearby, err = s.repo.CanteensNear(ctx, *input.Latitude, *input.Longitude, nearbyRadiusM, domain.MaxSuggestions)
		if err != nil {
			logger.Warn(ctx, "查询附近食堂失败", logger.Err(err))
		}
	}
	recent, err := s.repo.RecentCanteens(ctx, userID, s.now().Add(-recentWindow), domain.MaxSuggestions)
	if err != nil {
		logger.Warn(ctx, "查询最近食堂失败", logger.Err(err))
	}
	if located && len(recommended)+len(nearby)+len(recent) < domain.MaxSuggestions && s.geocoder != nil {
		school = s.schoolCanteens(ctx, *input.Latitude, *input.Longitude)
	}
	canteens := mergeCanteenSuggestions(domain.MaxSuggestions, recommended, nearby, recent, school)
	if len(canteens) == 0 && !input.Force {
		return &PromptView{Eligible: false, Canteens: []domain.Canteen{}}, nil
	}
	ids := make([]string, 0, len(canteens))
	for _, canteen := range canteens {
		ids = append(ids, canteen.ID)
		sources = append(sources, canteen.Reason)
	}
	prompt := &domain.Prompt{
		ID: uuid.NewString(), UserID: userID, AnalysisTaskID: taskID, Surface: normalizeSurface(input.Surface),
		LocationStatus: normalizeLocationStatus(input.LocationStatus, located), SuggestionSources: uniqueStrings(sources),
		SuggestedCanteenIDs: ids, SuggestedItemIDs: []string{}, GapKind: domain.GapNone, Cohort: s.cohortFor(ctx, userID),
	}
	if recommendedDish != nil {
		prompt.RecommendedItemID = &recommendedDish.ID
		prompt.RecommendedKind = normalizeRecommendedKind(input.RecommendedKind)
	}
	if len(nearby) > 0 {
		prompt.NearestDistanceM = nearby[0].DistanceM
	}
	created, err := s.repo.CreatePrompt(ctx, prompt)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "录餐食堂关联已提示", slog.String("user_id", userID), slog.String("task_id", taskID),
		slog.Any("sources", prompt.SuggestionSources), slog.Int("canteens", len(canteens)), slog.Bool("located", located),
		slog.String("cohort", prompt.Cohort), slog.Bool("recommended", recommendedDish != nil))
	view, err := s.view(ctx, created, task)
	if err != nil {
		return nil, err
	}
	view.Canteens = canteens
	return view, nil
}

func (s *Service) schoolCanteens(ctx context.Context, lat, lng float64) []domain.Canteen {
	geoCtx, cancel := context.WithTimeout(ctx, geocodeTimeout)
	defer cancel()
	result, err := s.geocoder.ReverseGeocode(geoCtx, lat, lng)
	if err != nil {
		logger.Warn(ctx, "逆地理编码失败，跳过按学校推荐食堂", logger.Err(err))
		return nil
	}
	canteens, err := s.repo.SchoolCanteensFromAddress(ctx, addressTexts(result), domain.MaxSuggestions)
	if err != nil {
		logger.Warn(ctx, "按地址查找学校食堂失败", logger.Err(err))
	}
	return canteens
}

// addressTexts collects every place string in a reverse-geocoding result.
func addressTexts(result map[string]any) []string {
	texts := []string{}
	var walk func(value any, depth int)
	walk = func(value any, depth int) {
		if depth > 4 {
			return
		}
		switch typed := value.(type) {
		case string:
			if text := strings.TrimSpace(typed); text != "" && len([]rune(text)) <= 80 {
				texts = append(texts, text)
			}
		case map[string]any:
			for _, child := range typed {
				walk(child, depth+1)
			}
		case []any:
			for _, child := range typed {
				walk(child, depth+1)
			}
		}
	}
	walk(result, 0)
	return texts
}

// DishesView lists a canteen's dishes, best guess first.
type DishesView struct {
	Canteen          domain.Canteen  `json:"canteen"`
	Windows          []domain.Window `json:"windows"`
	Dishes           []domain.Dish   `json:"dishes"`
	RecognitionReady bool            `json:"recognition_ready"`
	BestDishID       string          `json:"best_dish_id,omitempty"`
}

func (s *Service) CanteenDishes(ctx context.Context, userID, canteenID, taskID string) (*DishesView, error) {
	canteen, err := s.repo.CanteenByID(ctx, strings.TrimSpace(canteenID))
	if err != nil {
		return nil, err
	}
	if canteen == nil {
		return nil, commonerrors.ErrNotFound
	}
	var recognized []string
	if strings.TrimSpace(taskID) != "" {
		if task, err := s.repo.TaskForUser(ctx, strings.TrimSpace(userID), strings.TrimSpace(taskID)); err == nil && task != nil && task.Status == "done" {
			recognized = recognizedFoodNames(task.ResultMap())
		}
	}
	ranked, err := s.rankedDishes(ctx, canteen.ID, recognized)
	if err != nil {
		return nil, err
	}
	// Every window chip needs its own dishes: a global top-N would leave
	// most windows of a large canteen empty.
	view := &DishesView{Canteen: *canteen, Windows: windowsOf(ranked), Dishes: capPerWindow(ranked, dishesPerWindow),
		RecognitionReady: len(recognized) > 0}
	if len(ranked) > 0 && ranked[0].Score >= confidentScore {
		view.BestDishID = ranked[0].ID
	}
	return view, nil
}

func (s *Service) rankedDishes(ctx context.Context, canteenID string, recognized []string) ([]domain.Dish, error) {
	rows, err := s.repo.CanteenDishes(ctx, canteenID, maxMenuRows)
	if err != nil {
		return nil, err
	}
	dishes := make([]domain.Dish, 0, len(rows))
	for _, row := range rows {
		dishes = append(dishes, s.dishFromRow(row))
	}
	return rankDishes(dishes, recognized), nil
}

func (s *Service) dishFromRow(row repo.DishRow) domain.Dish {
	dish := domain.Dish{
		ID: row.ID, Name: strings.TrimSpace(row.FoodName), WindowName: strings.TrimSpace(row.WindowName), Floor: strings.TrimSpace(row.Floor),
		PriceText: formatPrice(row.Price, row.PriceMin, row.PriceMax, row.PriceType), HasRealPhoto: row.HasRealPhoto(), Popularity: row.Popularity,
	}
	if images := row.Images(); len(images) > 0 {
		dish.ImageURL = s.resolveImage(images[0])
	}
	return dish
}

func (s *Service) resolveImage(value string) string {
	if s.storage == nil {
		return value
	}
	if urls := s.storage.ResolveReferenceURLs("food-images", []string{value}); len(urls) > 0 {
		return urls[0]
	}
	return value
}

// AnswerInput records one step. Steps: canteen, dish, photo, skip.
type AnswerInput struct {
	Step             string   `json:"step"`
	Surface          string   `json:"surface"`
	CanteenID        string   `json:"canteen_id"`
	ItemID           string   `json:"item_id"`
	SuggestedItemIDs []string `json:"suggested_item_ids"`
	PhotoConsent     *bool    `json:"photo_consent"`
	// NotListed marks a skip at the dish step because the dish is missing
	// from the canteen's menu; it is how menu gaps are counted.
	NotListed bool     `json:"not_listed"`
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	AccuracyM *float64 `json:"accuracy_m"`
	// PriceKind answers the price question: same, changed (with Price) or skipped.
	PriceKind string   `json:"price_kind"`
	Price     *float64 `json:"price"`
}

func (s *Service) Answer(ctx context.Context, userID, promptID string, input AnswerInput) (*PromptView, error) {
	userID = strings.TrimSpace(userID)
	prompt, err := s.repo.PromptByID(ctx, userID, strings.TrimSpace(promptID))
	if err != nil {
		return nil, err
	}
	if prompt == nil {
		return nil, commonerrors.ErrNotFound
	}
	task, err := s.repo.TaskForUser(ctx, userID, prompt.AnalysisTaskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, commonerrors.ErrNotFound
	}
	now := s.now()
	updates := map[string]any{}
	switch strings.TrimSpace(input.Step) {
	case domain.StepCanteen:
		canteen, err := s.repo.CanteenByID(ctx, strings.TrimSpace(input.CanteenID))
		if err != nil {
			return nil, err
		}
		if canteen == nil {
			return nil, badRequest("食堂不存在")
		}
		updates["chosen_canteen_id"], updates["chosen_canteen_name"] = canteen.ID, canteen.Name
		updates["canteen_rank"], updates["canteen_answered_at"] = *rankOf(canteen.ID, prompt.SuggestedCanteenIDs), now
		s.recordLocationSample(ctx, canteen.ID, input)
	case domain.StepDish:
		dishUpdates, err := s.dishAnswer(ctx, prompt, task, input, now)
		if err != nil {
			return nil, err
		}
		for key, value := range dishUpdates {
			updates[key] = value
		}
	case domain.StepPhoto:
		photoUpdates, err := s.photoAnswer(ctx, userID, prompt, task, input, now)
		if err != nil {
			return nil, err
		}
		for key, value := range photoUpdates {
			updates[key] = value
		}
	case domain.StepPrice:
		priceUpdates, err := s.priceAnswer(ctx, prompt, input, now)
		if err != nil {
			return nil, err
		}
		for key, value := range priceUpdates {
			updates[key] = value
		}
	case domain.StepSkip:
		updates["skipped_at"], updates["skip_step"] = now, currentStep(prompt)
		if input.NotListed && prompt.ChosenCanteenID != nil && prompt.ChosenItemID == nil {
			updates["gap_kind"] = domain.GapMenu
		}
	default:
		return nil, badRequest("未知的步骤")
	}
	if surface := normalizeSurface(input.Surface); surface == domain.SurfaceResult && prompt.Surface != domain.SurfaceResult {
		updates["surface"] = surface
	}
	if err := s.repo.UpdatePrompt(ctx, userID, prompt.ID, updates); err != nil {
		return nil, err
	}
	logger.Info(ctx, "录餐食堂关联已回答", slog.String("user_id", userID), slog.String("prompt_id", prompt.ID), slog.String("step", input.Step))
	updated, err := s.repo.PromptByID(ctx, userID, prompt.ID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.Step) == domain.StepPrice && updated != nil {
		s.applyPriceIfAgreed(ctx, userID, updated)
		if updated, err = s.repo.PromptByID(ctx, userID, prompt.ID); err != nil {
			return nil, err
		}
	}
	return s.view(ctx, updated, task)
}

func (s *Service) dishAnswer(ctx context.Context, prompt *domain.Prompt, task *repo.Task, input AnswerInput, now time.Time) (map[string]any, error) {
	dish, err := s.repo.DishByID(ctx, strings.TrimSpace(input.ItemID))
	if err != nil {
		return nil, err
	}
	if dish == nil {
		return nil, badRequest("菜品不存在或已下架")
	}
	updates := map[string]any{
		"chosen_item_id": dish.ID, "chosen_item_name": strings.TrimSpace(dish.FoodName), "chosen_window_name": strings.TrimSpace(dish.WindowName),
		"chosen_price_text": formatPrice(dish.Price, dish.PriceMin, dish.PriceMax, dish.PriceType), "item_answered_at": now,
		"item_rank": *rankOf(dish.ID, input.SuggestedItemIDs), "suggested_item_ids": limitStrings(input.SuggestedItemIDs, 12),
		"gap_kind": domain.GapNone,
	}
	if prompt.ChosenCanteenID == nil || *prompt.ChosenCanteenID != dish.CanteenID {
		if canteen, err := s.repo.CanteenByID(ctx, dish.CanteenID); err == nil && canteen != nil {
			updates["chosen_canteen_id"], updates["chosen_canteen_name"] = canteen.ID, canteen.Name
			if prompt.CanteenAnsweredAt == nil {
				updates["canteen_rank"], updates["canteen_answered_at"] = *rankOf(canteen.ID, prompt.SuggestedCanteenIDs), now
			}
		}
	}
	if task.Status == "done" {
		if recognized := recognizedFoodNames(task.ResultMap()); len(recognized) > 0 {
			if ranked, err := s.rankedDishes(ctx, dish.CanteenID, recognized); err == nil {
				ids := make([]string, 0, len(ranked))
				for _, candidate := range ranked {
					ids = append(ids, candidate.ID)
				}
				updates["recognition_rank"] = *rankOf(dish.ID, ids)
			}
		}
	}
	photoAsked := !dish.HasRealPhoto() && len(task.Images()) > 0 && prompt.PhotoContributedAt == nil
	if photoAsked {
		updates["gap_kind"] = domain.GapPhoto
	}
	if s.shouldAskPrice(ctx, prompt, dish, photoAsked) {
		updates["price_asked_at"] = now
	}
	return updates, nil
}

// photoAnswer takes the user's photo for a dish that has none. The photo
// goes through the content check, then the catalog's versioned image
// contribution, then the one-per-dish upload credit.
func (s *Service) photoAnswer(ctx context.Context, userID string, prompt *domain.Prompt, task *repo.Task, input AnswerInput, now time.Time) (map[string]any, error) {
	if input.PhotoConsent == nil {
		return nil, badRequest("请选择是否使用这张照片")
	}
	updates := map[string]any{"photo_consent": *input.PhotoConsent}
	if !*input.PhotoConsent || prompt.PhotoContributedAt != nil {
		return updates, nil
	}
	if prompt.ChosenItemID == nil || prompt.GapKind != domain.GapPhoto {
		return nil, badRequest("这道菜不需要补充照片")
	}
	images := task.Images()
	if len(images) == 0 {
		return nil, badRequest("这次识别没有照片")
	}
	if s.contributor == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "照片共建服务未配置", HTTPStatus: 500}
	}
	if s.publication != nil {
		urls := make([]string, 0, len(images))
		for _, image := range images {
			urls = append(urls, s.resolveImage(image))
		}
		doc := map[string]any{"name": prompt.ChosenItemName, "image_paths": urls[:1]}
		if err := s.publication.CheckPublication(ctx, userID, 3, doc, s.storage); err != nil {
			return nil, err
		}
	}
	if err := s.contributor.ContributeDishPhoto(ctx, userID, *prompt.ChosenItemID, images[:1]); err != nil {
		return nil, err
	}
	updates["photo_contributed_at"] = now
	if s.rewards != nil {
		result, err := s.rewards.AwardPublicFoodUpload(ctx, userID, *prompt.ChosenItemID, map[string]any{
			"source": "meal_dish_prompt", "prompt_id": prompt.ID, "analysis_task_id": prompt.AnalysisTaskID,
		})
		if err != nil {
			logger.Warn(ctx, "菜品实拍图奖励发放失败", slog.String("prompt_id", prompt.ID), logger.Err(err))
		} else {
			updates["reward_credits"] = awardedCredits(result)
		}
	}
	return updates, nil
}

// awardedCredits reads the credits actually granted (0 when already claimed
// or over the daily cap).
func awardedCredits(result map[string]any) int {
	if awarded, _ := result["awarded"].(bool); !awarded {
		return 0
	}
	data, err := json.Marshal(result["reward_task"])
	if err != nil {
		return 0
	}
	var task struct {
		RewardCredits int `json:"reward_credits"`
	}
	if json.Unmarshal(data, &task) != nil {
		return 0
	}
	return task.RewardCredits
}

func (s *Service) recordLocationSample(ctx context.Context, canteenID string, input AnswerInput) {
	if input.Latitude == nil || input.Longitude == nil || !validCoordinate(*input.Latitude, *input.Longitude) {
		return
	}
	if input.AccuracyM != nil && *input.AccuracyM > maxSampleAccuracyM {
		return
	}
	sample := &domain.LocationSample{ID: uuid.NewString(), CanteenID: canteenID,
		Latitude: roundTo(*input.Latitude, 4), Longitude: roundTo(*input.Longitude, 4), AccuracyM: input.AccuracyM}
	if err := s.repo.AddLocationSample(ctx, sample); err != nil {
		logger.Warn(ctx, "保存食堂位置样本失败", slog.String("canteen_id", canteenID), logger.Err(err))
	}
}

// PromptForTask is what the result page reads. When the user has not picked
// a dish yet, it carries the top candidates from the chosen (or first
// suggested) canteen, ranked by what recognition saw.
func (s *Service) PromptForTask(ctx context.Context, userID, taskID string) (*PromptView, error) {
	userID, taskID = strings.TrimSpace(userID), strings.TrimSpace(taskID)
	prompt, err := s.repo.PromptByTask(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	if prompt == nil {
		return &PromptView{Eligible: false, Canteens: []domain.Canteen{}}, nil
	}
	task, err := s.repo.TaskForUser(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.view(ctx, prompt, task)
}

func (s *Service) view(ctx context.Context, prompt *domain.Prompt, task *repo.Task) (*PromptView, error) {
	view := &PromptView{Eligible: true, Prompt: prompt, Canteens: []domain.Canteen{}}
	for _, id := range prompt.SuggestedCanteenIDs {
		if canteen, err := s.repo.CanteenByID(ctx, id); err == nil && canteen != nil {
			view.Canteens = append(view.Canteens, *canteen)
		}
	}
	if prompt.ChosenCanteenID != nil {
		if canteen, err := s.repo.CanteenByID(ctx, *prompt.ChosenCanteenID); err == nil && canteen != nil {
			view.ChosenCanteen = canteen
		}
	}
	if prompt.ChosenItemID != nil {
		if row, err := s.repo.DishByID(ctx, *prompt.ChosenItemID); err == nil && row != nil {
			dish := s.dishFromRow(*row)
			view.ChosenDish = &DishView{ID: dish.ID, Name: dish.Name, WindowName: dish.WindowName, PriceText: dish.PriceText,
				ImageURL: dish.ImageURL, HasRealPhoto: dish.HasRealPhoto}
			if prompt.PriceAskedAt != nil && prompt.PriceAnswerKind == "" {
				view.PriceAsk = priceAskView(row)
			}
		}
		return view, nil
	}
	if prompt.SkippedAt != nil {
		return view, nil
	}
	if prompt.RecommendedItemID != nil {
		if row, err := s.repo.DishByID(ctx, *prompt.RecommendedItemID); err == nil && row != nil {
			view.RecommendedDish = s.dishView(ctx, *row)
		}
	}
	if task.Status != "done" {
		return view, nil
	}
	from := view.ChosenCanteen
	if from == nil && len(view.Canteens) > 0 {
		from = &view.Canteens[0]
	}
	if from == nil {
		return view, nil
	}
	ranked, err := s.rankedDishes(ctx, from.ID, recognizedFoodNames(task.ResultMap()))
	if err != nil {
		return nil, err
	}
	if len(ranked) > 3 {
		ranked = ranked[:3]
	}
	view.Candidates, view.CandidatesFrom = ranked, from
	return view, nil
}

func currentStep(prompt *domain.Prompt) string {
	photoPending := prompt.GapKind == domain.GapPhoto && prompt.PhotoConsent == nil && prompt.PhotoContributedAt == nil
	switch {
	case prompt.ChosenItemID != nil && !photoPending && prompt.PriceAskedAt != nil && prompt.PriceAnswerKind == "":
		return domain.StepPrice
	case prompt.ChosenItemID != nil:
		return domain.StepPhoto
	case prompt.ChosenCanteenID != nil:
		return domain.StepDish
	default:
		return domain.StepCanteen
	}
}

func normalizeSurface(value string) string {
	if strings.TrimSpace(value) == domain.SurfaceResult {
		return domain.SurfaceResult
	}
	return domain.SurfaceWait
}

func normalizeLocationStatus(value string, located bool) string {
	if located {
		return domain.LocationGranted
	}
	switch strings.TrimSpace(value) {
	case domain.LocationDenied, domain.LocationUnavailable:
		return strings.TrimSpace(value)
	default:
		return domain.LocationUnknown
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func limitStrings(values []string, limit int) []string {
	out := []string{}
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" && len(out) < limit {
			out = append(out, value)
		}
	}
	return out
}

func roundTo(value float64, places int) float64 {
	format := fmt.Sprintf("%%.%df", places)
	var rounded float64
	_, _ = fmt.Sscanf(fmt.Sprintf(format, value), "%f", &rounded)
	return rounded
}
