package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/migration/do"
	"food_link/backend/internal/researchweight/domain"
	researchrepo "food_link/backend/internal/researchweight/repo"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

const (
	imageBucket = "food-images"
	// MaxVideoBytes matches the analyze video limit the mini program knows.
	MaxVideoBytes = 8 * 1024 * 1024
)

var batchNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type Repository interface {
	Create(ctx context.Context, sample *domain.Sample) (*domain.Sample, bool, error)
	FindByClientKey(ctx context.Context, userID, clientKey string) (*domain.Sample, error)
	UsedPhotoKeys(ctx context.Context, userID string, keys []string) ([]string, error)
	CountSince(ctx context.Context, userID string, since time.Time) (int64, error)
	Mine(ctx context.Context, userID string, limit int) ([]domain.Sample, error)
	MineSummary(ctx context.Context, userID string) (domain.MineSummary, error)
	Get(ctx context.Context, id string) (*domain.Sample, error)
	List(ctx context.Context, filter domain.ListFilter) (*domain.ListResult, error)
	Review(ctx context.Context, id string, updates map[string]any) (*domain.Sample, error)
	MarkRewarded(ctx context.Context, id string) error
	Promote(ctx context.Context, id string, build func(*domain.Sample) *do.FoodWeightLabeledSampleDO) (*domain.Sample, error)
	ListContainers(ctx context.Context, userID string) ([]domain.Container, error)
	CreateContainer(ctx context.Context, container *domain.Container) error
	ArchiveContainer(ctx context.Context, userID, id string) error
	SavePhotoCheck(ctx context.Context, check *domain.PhotoCheck) error
	PhotoChecks(ctx context.Context, keys []string) (map[string]domain.PhotoCheck, error)
	SaveReadings(ctx context.Context, userID, key string, readings []domain.ScaleReading) error
	CountReadsSince(ctx context.Context, userID string, since time.Time) (int64, error)
	SameContentUploads(ctx context.Context, hashes, ownKeys []string) ([]domain.PhotoCheck, error)
	CountRewardedSince(ctx context.Context, userID string, since time.Time) (int64, error)
	PendingForAutoReview(ctx context.Context, before time.Time, limit int) ([]domain.Sample, error)
	ClaimForAutoReview(ctx context.Context, id string, lease time.Duration, maxAttempts int) (bool, error)
	UnpaidApproved(ctx context.Context, before time.Time, limit int) ([]domain.Sample, error)
}

// SampleAttribution is the campus campaign a new sample belongs to.
type SampleAttribution struct {
	CampaignID         string
	Channel            string
	StationSessionID   *string
	CanteenID          *string
	CatalogItemID      *string
	PairedFoodRecordID *string
}

// CampaignAttributor decides a new sample's campus campaign; nil means the
// personal channel.
type CampaignAttributor interface {
	AttributeSample(ctx context.Context, userID string, input SubmitInput) (*SampleAttribution, error)
}

type RewardAwarder interface {
	AwardResearchWeightSample(ctx context.Context, userID, sampleID string, credits int, meta map[string]any) (map[string]any, error)
}

// ObjectStore is the part of the storage client this module uses.
type ObjectStore interface {
	ResolveObjectKey(bucketAlias, value string) string
	BuildAccessURL(bucketAlias, key string) string
	UploadBytes(bucketAlias, key string, data []byte, contentType string) (string, error)
}

type SampleService struct {
	repo      Repository
	rewards   RewardAwarder
	store     ObjectStore
	reader    *ScaleReader
	campaigns CampaignAttributor
	now       func() time.Time
	// async runs background work; nil means a goroutine. Tests make it
	// synchronous.
	async func(func())
	// userLocks serialises one contributor's automatic reviews in this
	// process, so parallel submissions cannot all slip under the daily cap.
	userLocks sync.Map
}

func NewSampleService(repo Repository, rewards RewardAwarder, store ObjectStore) *SampleService {
	return &SampleService{repo: repo, rewards: rewards, store: store, now: time.Now}
}

type ReviewInput struct {
	Action        string `json:"action"`
	QualityTier   string `json:"quality_tier"`
	RewardCredits *int   `json:"reward_credits"`
	ReviewNote    string `json:"review_note"`
}

type PromoteInput struct {
	BatchName string `json:"batch_name"`
}

type MineResult struct {
	Items   []domain.SampleView `json:"items"`
	Summary domain.MineSummary  `json:"summary"`
}

type ListResult struct {
	Items []domain.SampleView `json:"items"`
	Total int64               `json:"total"`
}

func (s *SampleService) Submit(ctx context.Context, userID string, input SubmitInput) (*domain.SampleView, error) {
	library, err := s.libraryFor(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.FindByClientKey(ctx, userID, strings.TrimSpace(input.ClientKey))
	if err != nil {
		return nil, err
	}
	sample, err := BuildSample(userID, input, s.keyResolver(userID), library, s.now())
	if err != nil {
		if existing != nil {
			// A retry of a saved meal whose container was archived since.
			view := s.toView(existing)
			return &view, nil
		}
		return nil, err
	}
	if existing != nil {
		// A retried request returns the saved row; an edited draft under an
		// already-used key must not be silently dropped.
		if existing.TotalNetGrams != sample.TotalNetGrams || len(existing.Photos) != len(sample.Photos) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "这一顿已经提交过，请点「清空这一顿」后重新填写", HTTPStatus: 409}
		}
		view := s.toView(existing)
		return &view, nil
	}
	if err := s.rejectReusedPhotos(ctx, userID, sample.Photos); err != nil {
		return nil, err
	}
	if err := s.attribute(ctx, userID, input, sample); err != nil {
		return nil, err
	}
	count, err := s.repo.CountSince(ctx, userID, s.now().Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}
	if count >= domain.DailySubmissionLimit {
		return nil, badRequest(fmt.Sprintf("24小时内最多提交%d条，请明天再来", domain.DailySubmissionLimit))
	}
	saved, created, err := s.repo.Create(ctx, sample)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "称重科研样本提交完成", slog.String("user_id", userID), slog.String("sample_id", saved.ID),
		slog.String("weighing_mode", saved.WeighingMode), slog.Bool("created", created))
	view := s.toView(saved)
	if created {
		s.reviewSoon(ctx, saved.ID)
	}
	return &view, nil
}

// ConfigureCampaigns lets submissions carry the contributor's campus campaign.
func (s *SampleService) ConfigureCampaigns(campaigns CampaignAttributor) { s.campaigns = campaigns }

// attribute stamps a new sample with the campus campaign the server finds for
// the contributor; the channel is fixed at submission and never changed.
func (s *SampleService) attribute(ctx context.Context, userID string, input SubmitInput, sample *domain.Sample) error {
	sample.CollectionChannel = "personal"
	if s.campaigns == nil {
		return nil
	}
	attribution, err := s.campaigns.AttributeSample(ctx, userID, input)
	if err != nil || attribution == nil {
		return err
	}
	campaignID := attribution.CampaignID
	sample.CampaignID, sample.CollectionChannel = &campaignID, attribution.Channel
	sample.StationSessionID, sample.CanteenID = attribution.StationSessionID, attribution.CanteenID
	sample.CatalogItemID, sample.PairedFoodRecordID = attribution.CatalogItemID, attribution.PairedFoodRecordID
	return nil
}

func (s *SampleService) Mine(ctx context.Context, userID string) (*MineResult, error) {
	items, err := s.repo.Mine(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	summary, err := s.repo.MineSummary(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &MineResult{Items: s.toViews(items), Summary: summary}, nil
}

// libraryFor loads the user's saved containers only when the submission
// uses one, so ordinary submissions cost no extra query.
func (s *SampleService) libraryFor(ctx context.Context, userID string, input SubmitInput) (Library, error) {
	uses := strings.TrimSpace(input.TareMode) == domain.TareLibrary
	for _, item := range input.Items {
		uses = uses || strings.TrimSpace(item.TareSource) == domain.TareLibrary
	}
	if !uses {
		return Library{}, nil
	}
	containers, err := s.repo.ListContainers(ctx, userID)
	if err != nil {
		return nil, err
	}
	library := make(Library, len(containers))
	for _, container := range containers {
		library[container.ID] = container
	}
	return library, nil
}

// rejectReusedPhotos stops one photo from backing two samples. Empty-container
// photos are exempt: the same bowl or saved box is weighed once for many meals.
func (s *SampleService) rejectReusedPhotos(ctx context.Context, userID string, photos []domain.Photo) error {
	keys := make([]string, 0, len(photos))
	for _, photo := range photos {
		if !isTareRole(photo.Role) && photo.Source != domain.PhotoSourceLibrary {
			keys = append(keys, photo.ObjectKey)
		}
	}
	used, err := s.repo.UsedPhotoKeys(ctx, userID, keys)
	if err != nil {
		return err
	}
	if len(used) > 0 {
		return badRequest("有照片已在之前的样本里用过，请为这一份重新拍摄")
	}
	return nil
}

// UploadImage stores one original research photo under the user's prefix,
// unresized so later methods can use full resolution and EXIF.
func (s *SampleService) UploadImage(ctx context.Context, userID string, data []byte) (string, error) {
	if s.store == nil {
		return "", badRequest("存储服务不可用")
	}
	if len(data) == 0 || len(data) > MaxImageBytes {
		return "", badRequest("照片最多支持 15MB")
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		return "", badRequest("仅支持 JPG、PNG、WebP 或 HEIC 照片")
	}
	key := fmt.Sprintf("%sphotos/%s%s", researchKeyPrefix(userID), uuid.NewString(), ext)
	url, err := s.store.UploadBytes(imageBucket, key, data, contentType)
	if err != nil {
		return "", err
	}
	if err := s.recordUpload(ctx, userID, key, data); err != nil {
		return "", err
	}
	logger.Info(ctx, "称重科研照片上传完成", slog.String("user_id", userID), slog.Int("file.size", len(data)))
	return url, nil
}

// UploadVideo stores the original orbit clip; unlike analyze videos it keeps
// the file itself so later methods can sample any frames.
func (s *SampleService) UploadVideo(ctx context.Context, userID string, data []byte, ext, contentType string) (string, error) {
	if s.store == nil {
		return "", badRequest("存储服务不可用")
	}
	if len(data) == 0 || len(data) > MaxVideoBytes {
		return "", badRequest("视频最多支持 8MB")
	}
	if !isVideoContainer(data) {
		return "", badRequest("仅支持 MP4、MOV 或 M4V 视频")
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext != ".mp4" && ext != ".mov" && ext != ".m4v" {
		ext = ".mp4"
	}
	if contentType == "" {
		contentType = "video/mp4"
	}
	key := fmt.Sprintf("%svideos/%s%s", researchKeyPrefix(userID), uuid.NewString(), ext)
	url, err := s.store.UploadBytes(imageBucket, key, data, contentType)
	if err != nil {
		return "", err
	}
	logger.Info(ctx, "称重科研视频上传完成", slog.String("user_id", userID), slog.Int("file.size", len(data)))
	return url, nil
}

func (s *SampleService) List(ctx context.Context, filter domain.ListFilter) (*ListResult, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 40
	}
	result, err := s.repo.List(ctx, filter)
	if err != nil {
		return nil, err
	}
	return &ListResult{Items: s.toViews(result.Items), Total: result.Total}, nil
}

func (s *SampleService) Get(ctx context.Context, id string) (*domain.SampleView, error) {
	sample, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	view := s.toView(sample)
	return &view, nil
}

func (s *SampleService) Review(ctx context.Context, id, reviewerID string, input ReviewInput) (*domain.SampleView, error) {
	updates, err := reviewUpdates(input, reviewerID, s.now())
	if err != nil {
		return nil, err
	}
	if updates["status"] == domain.StatusApproved && input.RewardCredits == nil {
		current, err := s.repo.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		updates["reward_credits"] = DefaultRewardCredits(current)
	}
	return s.commitReview(ctx, id, reviewerID, updates)
}

// commitReview applies a reviewer's or the automatic review's decision and
// pays the reward exactly once.
func (s *SampleService) commitReview(ctx context.Context, id, reviewerID string, updates map[string]any) (*domain.SampleView, error) {
	sample, err := s.repo.Review(ctx, id, updates)
	if errors.Is(err, researchrepo.ErrNotPending) && updates["status"] == domain.StatusApproved {
		// A retry after a failed payout: the sample is already approved, so
		// only the missing reward is still owed.
		current, getErr := s.repo.Get(ctx, id)
		if getErr != nil || current.Status != domain.StatusApproved || current.RewardedAt != nil || current.RewardCredits == 0 {
			return nil, err
		}
		sample, err = current, nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.payReward(ctx, sample); err != nil {
		return nil, err
	}
	logger.Info(ctx, "称重科研样本审核完成", slog.String("sample_id", sample.ID), slog.String("status", sample.Status), slog.String("reviewer_id", reviewerID))
	return s.Get(ctx, sample.ID)
}

// payReward pays an approved sample's credits once. The ledger's source key
// makes a repeated award (a retry, another replica) fail instead of paying
// twice, so retrying an unpaid sample is safe.
func (s *SampleService) payReward(ctx context.Context, sample *domain.Sample) error {
	if sample.Status != domain.StatusApproved || sample.RewardCredits <= 0 || sample.RewardedAt != nil || s.rewards == nil {
		return nil
	}
	_, err := s.rewards.AwardResearchWeightSample(ctx, sample.UserID, sample.ID, sample.RewardCredits, map[string]any{
		"dish_name": sample.DishName, "weighing_mode": sample.WeighingMode, "quality_tier": sample.QualityTier,
		"review_mode": sample.ReviewMode,
	})
	if err != nil {
		logger.Error(ctx, "称重科研样本审核通过但积分发放失败", err, slog.String("sample_id", sample.ID), slog.String("user_id", sample.UserID))
		return err
	}
	return s.repo.MarkRewarded(ctx, sample.ID)
}

// DefaultRewardCredits pays for the extra work: itemized samples need a reading
// per component, and each extra container in a meal adds one credit (up to 6).
func DefaultRewardCredits(sample *domain.Sample) int {
	switch sample.WeighingMode {
	case domain.ModeItemized:
		return 4
	case domain.ModeMulti:
		return min(2+max(len(sample.Items)-1, 0), 6)
	}
	return 2
}

func reviewUpdates(input ReviewInput, reviewerID string, now time.Time) (map[string]any, error) {
	note := strings.TrimSpace(input.ReviewNote)
	if runeLen(note) > 300 {
		return nil, badRequest("审核备注不超过300字")
	}
	updates := map[string]any{"review_note": note, "reviewed_at": now, "reviewed_by": reviewerID, "review_mode": domain.ReviewModeManual}
	switch strings.TrimSpace(input.Action) {
	case "approve":
		tier := strings.ToUpper(strings.TrimSpace(input.QualityTier))
		if !slices.Contains(domain.QualityTiers, tier) {
			return nil, badRequest("通过时请选择数据等级 A/B/C")
		}
		updates["status"] = domain.StatusApproved
		updates["quality_tier"] = tier
		if input.RewardCredits != nil {
			if *input.RewardCredits < 0 || *input.RewardCredits > domain.MaxRewardCredits {
				return nil, badRequest(fmt.Sprintf("奖励积分需在0到%d之间", domain.MaxRewardCredits))
			}
			updates["reward_credits"] = *input.RewardCredits
		}
	case "reject":
		if note == "" {
			return nil, badRequest("驳回时必须填写原因")
		}
		updates["status"] = domain.StatusRejected
	default:
		return nil, badRequest("审核动作不正确")
	}
	return updates, nil
}

func (s *SampleService) Promote(ctx context.Context, id string, input PromoteInput) (*domain.SampleView, error) {
	batch := strings.TrimSpace(input.BatchName)
	if batch == "" {
		batch = "research-" + s.now().Format("200601")
	}
	if !batchNamePattern.MatchString(batch) {
		return nil, badRequest("批次名只能包含字母、数字、下划线和短横线")
	}
	sample, err := s.repo.Promote(ctx, id, func(sample *domain.Sample) *do.FoodWeightLabeledSampleDO {
		return s.toLabeledSample(sample, batch)
	})
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "称重科研样本加入评测集", slog.String("sample_id", sample.ID), slog.String("batch_name", batch))
	view := s.toView(sample)
	return &view, nil
}

// toLabeledSample maps a sample onto the benchmark dataset row: the top view
// is the evaluated image, and the other photos travel in metadata.
func (s *SampleService) toLabeledSample(sample *domain.Sample, batch string) *do.FoodWeightLabeledSampleDO {
	topKey := photoKey(sample.Photos, domain.RoleEvalTop)
	if topKey == "" {
		topKey = photoKey(sample.Photos, domain.RoleEvalAngle)
	}
	labeled := &do.FoodWeightLabeledSampleDO{
		ID: uuid.NewString(), BatchName: batch, SampleName: fmt.Sprintf("%s-%s", sample.DishName, sample.ID[:8]),
		OriginalFilename: path.Base(topKey), Status: "labeled", Items: map[string]any{},
		Metadata: map[string]any{
			"source": "research_weight_samples", "research_sample_id": sample.ID, "scene": sample.Scene,
			"weighing_mode": sample.WeighingMode, "quality_tier": sample.QualityTier, "container_type": sample.ContainerType,
			"reference_object": sample.ReferenceObject, "photos": sample.Photos, "video_object_key": sample.VideoObjectKey,
			"device": sample.Device, "consent_version": sample.ConsentVersion, "promoted_at": s.now().UTC().Format(time.RFC3339),
			"items": sample.Items, "flags": sampleFlags(sample),
		},
	}
	if topKey != "" {
		labeled.ImageObjectKey = &topKey
		if s.store != nil {
			url := s.store.BuildAccessURL(imageBucket, topKey)
			labeled.ImageURL = &url
		}
	}
	total := sample.TotalNetGrams
	labeled.TotalWeightGrams = &total
	// A meal with several containers is labeled per container; one container
	// (or all boxes weighed together) only has a total.
	if sample.WeighingMode == domain.ModeItemized || (sample.WeighingMode == domain.ModeMulti && len(sample.Items) > 1) {
		labeled.LabelType = "items"
		labeled.Items = itemsByUniqueName(sample.Items)
	} else {
		labeled.LabelType = "total"
		labeled.Items["__total__"] = total
	}
	return labeled
}

// itemsByUniqueName keys benchmark items by name, numbering repeats ("米饭",
// "米饭#2") so two scoops of the same food stay separate.
func itemsByUniqueName(items []domain.Item) map[string]any {
	result := make(map[string]any, len(items))
	for _, item := range items {
		name := item.Name
		for n := 2; ; n++ {
			if _, exists := result[name]; !exists {
				break
			}
			name = fmt.Sprintf("%s#%d", item.Name, n)
		}
		result[name] = item.Grams
	}
	return result
}

func photoKey(photos []domain.Photo, role string) string {
	for _, photo := range photos {
		if photo.Role == role {
			return photo.ObjectKey
		}
	}
	return ""
}

// keyResolver accepts only keys this user uploaded through the research
// upload endpoints.
func (s *SampleService) keyResolver(userID string) KeyResolver {
	return func(raw string) string {
		if s.store == nil || raw == "" {
			return ""
		}
		key := s.store.ResolveObjectKey(imageBucket, raw)
		if !validResearchKey(userID, key) {
			return ""
		}
		return key
	}
}

func (s *SampleService) accessURL(key string) string {
	if s.store == nil || key == "" {
		return key
	}
	return s.store.BuildAccessURL(imageBucket, key)
}

func (s *SampleService) toViews(items []domain.Sample) []domain.SampleView {
	views := make([]domain.SampleView, 0, len(items))
	for index := range items {
		views = append(views, s.toView(&items[index]))
	}
	return views
}

func (s *SampleService) toView(sample *domain.Sample) domain.SampleView {
	photos := make([]domain.PhotoView, 0, len(sample.Photos))
	for _, photo := range sample.Photos {
		photos = append(photos, domain.PhotoView{Photo: photo, URL: s.accessURL(photo.ObjectKey)})
	}
	items := sample.Items
	if items == nil {
		items = []domain.Item{}
	}
	return domain.SampleView{
		ID: sample.ID, UserID: sample.UserID, Scene: sample.Scene, WeighingMode: sample.WeighingMode,
		DishName: sample.DishName, VenueName: sample.VenueName, City: sample.City, ContainerType: sample.ContainerType,
		TareMode: sample.TareMode, TareGrams: sample.TareGrams, GrossReadingGrams: sample.GrossReadingGrams,
		TotalNetGrams: sample.TotalNetGrams, ScalePrecisionGrams: sample.ScalePrecisionGrams, Items: items,
		Photos: photos, ReferenceObject: sample.ReferenceObject, VideoURL: s.accessURL(sample.VideoObjectKey),
		Device: sample.Device, Notes: sample.Notes, ConsentVersion: sample.ConsentVersion, Status: sample.Status,
		QualityTier: sample.QualityTier, ReviewNote: sample.ReviewNote, ReviewedAt: sample.ReviewedAt,
		RewardCredits: sample.RewardCredits, RewardedAt: sample.RewardedAt, BenchmarkSampleID: sample.BenchmarkSampleID, CreatedAt: sample.CreatedAt,
		Flags: sampleFlags(sample), ReviewMode: sample.ReviewMode, AutoReview: sample.AutoReview,
		CollectionChannel: sample.CollectionChannel, CampaignID: sample.CampaignID, CatalogItemID: sample.CatalogItemID,
	}
}
