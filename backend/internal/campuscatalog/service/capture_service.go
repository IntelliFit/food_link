package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/campuscatalog/domain"
	campusrepo "food_link/backend/internal/campuscatalog/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// CaptureExtractTaskType is the worker task that reads one session's menus.
const CaptureExtractTaskType = "canteen_menu_extract"

const (
	captureMaxMenuPhotos = 12
	captureMaxDishPhotos = 80
	captureMaxAddedItems = 80
)

type captureRepository interface {
	CreateCaptureSession(ctx context.Context, session *domain.CaptureSession) (*domain.CaptureSession, error)
	GetCaptureSession(ctx context.Context, id string) (*domain.CaptureSession, error)
	ListCaptureSessionsByUser(ctx context.Context, userID string, limit, offset int) ([]domain.CaptureSession, int64, error)
	UpdateCaptureSession(ctx context.Context, id string, expectStatuses []string, updates map[string]any) (bool, error)
	ListPendingCaptureExceptions(ctx context.Context, limit int) ([]domain.CaptureSession, error)
	ListCapturedWindows(ctx context.Context, canteenKeyPrefix string, limit int) ([]campusrepo.CapturedWindowSummary, error)
	CreateCaptureAsset(ctx context.Context, asset *domain.CaptureAsset) (*domain.CaptureAsset, bool, error)
	ListCaptureAssets(ctx context.Context, sessionID string) ([]domain.CaptureAsset, error)
	UpdateCaptureAsset(ctx context.Context, sessionID, assetID string, updates map[string]any) (bool, error)
	CountReusedCaptureHashes(ctx context.Context, hashes []string, sessionID, userID, windowKey string) (int, error)
	CreateLedgerEntry(ctx context.Context, entry *domain.CollectorLedgerEntry) error
	FindLedgerBySourceKey(ctx context.Context, sourceKey string) (*domain.CollectorLedgerEntry, error)
	WindowRewardTaken(ctx context.Context, windowKey string) (bool, error)
	GetLedgerTotals(ctx context.Context, userID string) (*campusrepo.LedgerTotals, error)
	CreateLedgerSpend(ctx context.Context, entry *domain.CollectorLedgerEntry, check func(*campusrepo.LedgerTotals) error) error
	UpdateLedgerStatus(ctx context.Context, id string, fromStatuses []string, toStatus, note string, extraUpdates map[string]any) (bool, error)
	ListLedgerByUser(ctx context.Context, userID string, limit int) ([]domain.CollectorLedgerEntry, error)
	ListLedgerByTypeStatus(ctx context.Context, entryType, status string, limit int) ([]domain.CollectorLedgerEntry, error)
	ReleaseRatePendingRewards(ctx context.Context, amountFor func(meta map[string]any) int64, limit int) (int, error)
}

type captureTaskStore interface {
	CreateTask(ctx context.Context, task *analyzedomain.AnalysisTask) error
	FailTask(ctx context.Context, taskID string, errorMsg string) (bool, error)
	CompleteTask(ctx context.Context, taskID string, result map[string]any) (bool, error)
}

// CapturePublicationChecker runs the platform content check (text and
// images) before capture items become public. StartDocument only submits the
// images; WeChat answers asynchronously, and CheckPublication reuses that
// answer for the same user, scene and image URL.
type CapturePublicationChecker interface {
	CheckPublication(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error
	StartDocument(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error
}

// captureContentScene is the WeChat content-check scene for catalog posts.
const captureContentScene = 3

// captureReviewStartTimeout bounds a dish photo's background review start,
// which outlives the upload request.
const captureReviewStartTimeout = 20 * time.Second

// CaptureMembershipGranter extends a collector's membership when they spend
// earnings on it. The source key makes a retried grant a no-op.
type CaptureMembershipGranter interface {
	GrantCaptureMembership(ctx context.Context, userID, sourceKey, planCode string, days int, meta map[string]any) error
}

// CaptureImageUploader stores one photo and returns its reference. Production
// uses the catalog COS upload; tests inject a fake.
type CaptureImageUploader func(ctx context.Context, userID, keyPrefix, sourceFilename, contentType string, data []byte) (string, error)

type captureDeps struct {
	repo        captureRepository
	extractor   *CaptureExtractor
	tasks       captureTaskStore
	queue       taskqueue.Publisher
	rules       CaptureRewardRules
	membership  CaptureMembershipGranter
	publication CapturePublicationChecker
	upload      CaptureImageUploader
}

type CaptureDeps struct {
	Repo        captureRepository
	Extractor   *CaptureExtractor
	Tasks       captureTaskStore
	Queue       taskqueue.Publisher
	Rules       CaptureRewardRules
	Membership  CaptureMembershipGranter
	Publication CapturePublicationChecker
	Upload      CaptureImageUploader
}

func (s *CatalogService) ConfigureCapture(deps CaptureDeps) {
	s.capture = &captureDeps{
		repo: deps.Repo, extractor: deps.Extractor, tasks: deps.Tasks, queue: deps.Queue,
		rules: deps.Rules, membership: deps.Membership, publication: deps.Publication, upload: deps.Upload,
	}
	if s.capture.upload == nil {
		s.capture.upload = func(ctx context.Context, userID, keyPrefix, sourceFilename, contentType string, data []byte) (string, error) {
			return s.uploadCatalogImage(ctx, "user_id", userID, keyPrefix, sourceFilename, contentType, data)
		}
	}
}

func (s *CatalogService) captureReady() (*captureDeps, error) {
	if s.capture == nil || s.capture.repo == nil {
		return nil, appError("窗口采集服务未配置")
	}
	return s.capture, nil
}

type CaptureSessionInput struct {
	ClientSessionKey string  `json:"client_session_key"`
	VenueType        string  `json:"venue_type"`
	SchoolID         *string `json:"school_id"`
	CampusID         *string `json:"campus_id"`
	CanteenID        *string `json:"canteen_id"`
	OrganizationName string  `json:"organization_name"`
	AreaName         string  `json:"area_name"`
	CanteenName      string  `json:"canteen_name"`
	Floor            string  `json:"floor"`
	WindowName       string  `json:"window_name"`
	// ServiceMode is the optional window type the collector sees on site:
	// fixed_portion, combo, self_select or unknown.
	ServiceMode string `json:"service_mode"`
}

var captureServiceModes = enumSet("unknown", "fixed_portion", "combo", "self_select")

// CreateCaptureSession opens (or returns, on retry) a session for one window.
// Anyone signed in may collect; university windows must match the directory.
func (s *CatalogService) CreateCaptureSession(ctx context.Context, userID string, input CaptureSessionInput) (*CaptureSessionView, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	clientKey := strings.TrimSpace(input.ClientSessionKey)
	if clientKey == "" || len(clientKey) > 120 {
		return nil, badRequest("采集标识不正确")
	}
	windowName := strings.TrimSpace(input.WindowName)
	floor := strings.TrimSpace(input.Floor)
	if windowName == "" {
		return nil, badRequest("请填写窗口名称")
	}
	if utf8.RuneCountInString(windowName) > 40 || utf8.RuneCountInString(floor) > 20 {
		return nil, badRequest("窗口名称最多 40 个字，楼层最多 20 个字")
	}
	serviceMode, ok := normalizeEnum(input.ServiceMode, "unknown", captureServiceModes)
	if !ok {
		return nil, badRequest("窗口类型不正确")
	}
	session := &domain.CaptureSession{
		ID: uuid.NewString(), ClientSessionKey: clientKey, UserID: userID, ServiceMode: serviceMode,
		Floor: floor, WindowName: windowName, Status: domain.CaptureStatusDraft,
		ExceptionStatus: domain.CaptureExceptionNone,
	}
	if err := s.resolveCaptureVenue(ctx, session, input); err != nil {
		return nil, err
	}
	session.WindowKey = captureWindowKey(session)
	created, err := deps.repo.CreateCaptureSession(ctx, session)
	if err != nil {
		return nil, err
	}
	if created == nil || created.UserID != userID {
		return nil, &commonerrors.AppError{Code: 10003, Message: "该采集标识已被使用", HTTPStatus: 409}
	}
	logger.Info(ctx, "窗口采集会话已创建", slog.String("user_id", userID), slog.String("session_id", created.ID),
		slog.String("window_key", created.WindowKey))
	return s.buildCaptureView(ctx, deps, created)
}

func (s *CatalogService) resolveCaptureVenue(ctx context.Context, session *domain.CaptureSession, input CaptureSessionInput) error {
	venueType, ok := normalizeEnum(input.VenueType, "university", venueTypes)
	if !ok {
		return badRequest("场所类型不正确")
	}
	session.VenueType = venueType
	if venueType == "university" {
		communityRepo, ok := s.repo.(communityBatchRepository)
		if !ok {
			return appError("校园目录服务未配置")
		}
		schoolID, campusID, canteenID := pointerValue(input.SchoolID), pointerValue(input.CampusID), pointerValue(input.CanteenID)
		if schoolID == "" || campusID == "" || canteenID == "" {
			return badRequest("请选择学校、校区和食堂")
		}
		ref, err := communityRepo.GetCampusDirectoryRef(ctx, schoolID, campusID, canteenID, "")
		if err != nil {
			return err
		}
		if ref == nil || ref.SchoolID == "" || ref.CampusID == "" || ref.CanteenID == "" {
			return badRequest("请选择同一学校下已启用的校区和食堂")
		}
		session.SchoolID, session.CampusID, session.CanteenID = stringPointer(ref.SchoolID), stringPointer(ref.CampusID), stringPointer(ref.CanteenID)
		session.OrganizationName, session.AreaName, session.CanteenName = ref.SchoolName, ref.CampusName, ref.CanteenName
		return nil
	}
	if pointerValue(input.SchoolID) != "" || pointerValue(input.CampusID) != "" || pointerValue(input.CanteenID) != "" {
		return badRequest("社区或园区食堂不能关联学校目录")
	}
	session.OrganizationName = strings.TrimSpace(input.OrganizationName)
	session.AreaName = strings.TrimSpace(input.AreaName)
	session.CanteenName = strings.TrimSpace(input.CanteenName)
	if session.OrganizationName == "" || session.CanteenName == "" {
		return badRequest("请填写机构名称和食堂名称")
	}
	if utf8.RuneCountInString(session.OrganizationName) > 200 || utf8.RuneCountInString(session.CanteenName) > 200 {
		return badRequest("地点名称最多 200 个字")
	}
	return nil
}

// captureCanteenKey identifies a canteen; captureWindowKey adds the floor and
// window so one window earns at most one reward.
func captureCanteenKey(venueType, canteenID, organization, canteen string) string {
	if strings.TrimSpace(canteenID) != "" {
		return "canteen:" + strings.TrimSpace(canteenID)
	}
	return "venue:" + venueType + ":" + normalizeCaptureText(organization) + ":" + normalizeCaptureText(canteen)
}

func captureWindowKey(session *domain.CaptureSession) string {
	floor := strings.NewReplacer("楼", "", "层", "", "f", "").Replace(normalizeCaptureText(session.Floor))
	window := strings.NewReplacer("窗口", "", "档口", "").Replace(normalizeCaptureText(session.WindowName))
	return captureCanteenKey(session.VenueType, pointerValue(session.CanteenID), session.OrganizationName, session.CanteenName) +
		"|" + floor + "|" + window
}

// ListCapturedWindows shows which windows of one canteen were already
// collected (and paid), so collectors can choose an uncollected one.
func (s *CatalogService) ListCapturedWindows(ctx context.Context, venueType, canteenID, organization, canteen string) ([]campusrepo.CapturedWindowSummary, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	venue, ok := normalizeEnum(venueType, "university", venueTypes)
	if !ok {
		return nil, badRequest("场所类型不正确")
	}
	if strings.TrimSpace(canteenID) == "" && (strings.TrimSpace(organization) == "" || strings.TrimSpace(canteen) == "") {
		return nil, badRequest("请先选择食堂")
	}
	return deps.repo.ListCapturedWindows(ctx, captureCanteenKey(venue, canteenID, organization, canteen)+"|", 200)
}

func (s *CatalogService) loadOwnedCaptureSession(ctx context.Context, deps *captureDeps, userID, sessionID string) (*domain.CaptureSession, error) {
	session, err := deps.repo.GetCaptureSession(ctx, strings.TrimSpace(sessionID))
	if err != nil {
		return nil, err
	}
	if session == nil || session.UserID != strings.TrimSpace(userID) {
		return nil, notFound("采集记录不存在")
	}
	return session, nil
}

type CaptureAssetInput struct {
	Kind     string
	ItemKey  string
	DishName string
}

// UploadCaptureAsset stores one original photo. Re-uploading the same photo
// to the same session returns the existing record.
func (s *CatalogService) UploadCaptureAsset(ctx context.Context, userID, sessionID string, input CaptureAssetInput, sourceFilename, contentType string, data []byte) (*domain.CaptureAsset, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := s.loadOwnedCaptureSession(ctx, deps, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status == domain.CaptureStatusSubmitted {
		return nil, badRequest("该窗口已提交，请新建一次采集")
	}
	kind, ok := normalizeEnum(input.Kind, domain.CaptureAssetMenu, enumSet(domain.CaptureAssetMenu, domain.CaptureAssetDish, domain.CaptureAssetStall, domain.CaptureAssetOther))
	if !ok {
		return nil, badRequest("照片类型不正确")
	}
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	if limitErr := captureAssetLimit(assets, kind); limitErr != nil {
		return nil, limitErr
	}
	sum := sha256.Sum256(data)
	imageURL, err := deps.upload(ctx, session.UserID, "canteen-capture/"+session.UserID, sourceFilename, contentType, data)
	if err != nil {
		return nil, err
	}
	keys, err := s.normalizeImageKeys([]string{imageURL})
	if err != nil || len(keys) == 0 {
		return nil, appError("照片保存失败，请重试")
	}
	asset := &domain.CaptureAsset{
		ID: uuid.NewString(), SessionID: session.ID, UserID: session.UserID, Kind: kind,
		ObjectKey: keys[0], ContentSHA256: hex.EncodeToString(sum[:]), SourceFilename: strings.TrimSpace(sourceFilename),
		ItemKey: strings.TrimSpace(input.ItemKey), DishName: strings.TrimSpace(input.DishName), Status: "active",
	}
	if kind != domain.CaptureAssetDish {
		asset.ItemKey, asset.DishName = "", ""
	}
	saved, _, err := deps.repo.CreateCaptureAsset(ctx, asset)
	if err != nil {
		return nil, err
	}
	if saved.Kind == domain.CaptureAssetDish {
		s.startCaptureImageReview(ctx, deps, session.UserID, saved.ObjectKey)
	}
	s.resolveCaptureAssetURL(saved)
	return saved, nil
}

// startCaptureImageReview submits a dish photo to the WeChat image check in
// the background, so a window with many photos has its answers by submit.
// Submit still runs the blocking check; if this start fails, submit sends it.
func (s *CatalogService) startCaptureImageReview(ctx context.Context, deps *captureDeps, userID, objectKey string) {
	if deps.publication == nil || strings.TrimSpace(objectKey) == "" {
		return
	}
	doc := map[string]any{"image_paths": s.captureImageURLs([]string{objectKey})}
	reviewCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), captureReviewStartTimeout)
	go func() {
		defer cancel()
		if err := deps.publication.StartDocument(reviewCtx, userID, captureContentScene, doc, s.storage); err != nil {
			logger.Warn(reviewCtx, "窗口采集实物照预审提交失败，提交时会再次审核", slog.String("user_id", userID),
				slog.String("object_key", objectKey), logger.Err(err))
		}
	}()
}

func captureAssetLimit(assets []domain.CaptureAsset, kind string) error {
	count := 0
	for _, asset := range assets {
		if asset.Kind == kind || (kind != domain.CaptureAssetMenu && asset.Kind != domain.CaptureAssetMenu) {
			count++
		}
	}
	if kind == domain.CaptureAssetMenu && count >= captureMaxMenuPhotos {
		return badRequest(fmt.Sprintf("一个窗口最多上传 %d 张菜单照片", captureMaxMenuPhotos))
	}
	if kind != domain.CaptureAssetMenu && count >= captureMaxDishPhotos {
		return badRequest(fmt.Sprintf("一个窗口最多上传 %d 张实物照片", captureMaxDishPhotos))
	}
	return nil
}

func (s *CatalogService) resolveCaptureAssetURL(asset *domain.CaptureAsset) {
	if asset == nil {
		return
	}
	if s.storage == nil {
		asset.URL = asset.ObjectKey
		return
	}
	if urls := s.storage.ResolveReferenceURLs("food-images", []string{asset.ObjectKey}); len(urls) > 0 {
		asset.URL = urls[0]
	}
}

// UpdateCaptureAsset binds a dish photo to an extracted item (or a dish the
// collector named), or removes a photo from the session.
func (s *CatalogService) UpdateCaptureAsset(ctx context.Context, userID, sessionID, assetID string, input CaptureAssetInput, remove bool) (*CaptureSessionView, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := s.loadOwnedCaptureSession(ctx, deps, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status == domain.CaptureStatusSubmitted {
		return nil, badRequest("该窗口已提交，不能再修改照片")
	}
	updates := map[string]any{"item_key": strings.TrimSpace(input.ItemKey), "dish_name": strings.TrimSpace(input.DishName)}
	if remove {
		updates = map[string]any{"status": "removed"}
	} else if kind := strings.TrimSpace(input.Kind); kind != "" {
		normalized, ok := normalizeEnum(kind, domain.CaptureAssetDish, enumSet(domain.CaptureAssetMenu, domain.CaptureAssetDish, domain.CaptureAssetStall, domain.CaptureAssetOther))
		if !ok {
			return nil, badRequest("照片类型不正确")
		}
		updates["kind"] = normalized
	}
	changed, err := deps.repo.UpdateCaptureAsset(ctx, session.ID, strings.TrimSpace(assetID), updates)
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, notFound("照片不存在")
	}
	view, err := s.buildCaptureView(ctx, deps, session)
	if err != nil {
		return nil, err
	}
	if updates["kind"] == domain.CaptureAssetDish {
		for _, asset := range view.Assets {
			if asset.ID == strings.TrimSpace(assetID) {
				s.startCaptureImageReview(ctx, deps, session.UserID, asset.ObjectKey)
			}
		}
	}
	return view, nil
}

// StartCaptureExtraction queues the two-pass menu reading for all current
// menu photos. It can be re-run after more menu photos are added.
func (s *CatalogService) StartCaptureExtraction(ctx context.Context, userID, sessionID string) (*CaptureSessionView, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	if deps.tasks == nil || deps.queue == nil {
		return nil, appError("菜单识别服务未配置")
	}
	session, err := s.loadOwnedCaptureSession(ctx, deps, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status == domain.CaptureStatusSubmitted || session.Status == domain.CaptureStatusExtracting {
		return s.buildCaptureView(ctx, deps, session)
	}
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	menuIDs := []string{}
	for _, asset := range assets {
		if asset.Kind == domain.CaptureAssetMenu {
			menuIDs = append(menuIDs, asset.ID)
		}
	}
	if len(menuIDs) == 0 {
		return nil, badRequest("请先拍菜单照片")
	}
	task := &analyzedomain.AnalysisTask{
		ID: uuid.NewString(), UserID: session.UserID, TaskType: CaptureExtractTaskType, Status: "pending",
		Payload: map[string]any{"session_id": session.ID, "asset_ids": menuIDs, "purpose": CaptureExtractTaskType},
	}
	changed, err := deps.repo.UpdateCaptureSession(ctx, session.ID,
		[]string{domain.CaptureStatusDraft, domain.CaptureStatusExtracted, domain.CaptureStatusFailed},
		map[string]any{"status": domain.CaptureStatusExtracting, "extract_task_id": task.ID, "extract_error": ""})
	if err != nil {
		return nil, err
	}
	if !changed {
		return s.reloadCaptureView(ctx, deps, session.ID)
	}
	if err := deps.tasks.CreateTask(ctx, task); err != nil {
		s.markCaptureExtractFailed(ctx, deps, session.ID, task.ID, "识别任务创建失败，请重试")
		return nil, err
	}
	publishCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := deps.queue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType}); err != nil {
		_, _ = deps.tasks.FailTask(context.Background(), task.ID, "canteen menu extract enqueue failed")
		s.markCaptureExtractFailed(ctx, deps, session.ID, task.ID, "识别任务排队失败，请重试")
		return nil, err
	}
	logger.Info(ctx, "窗口菜单识别已排队", slog.String("session_id", session.ID), slog.String("task_id", task.ID), slog.Int("menu_photos", len(menuIDs)))
	return s.reloadCaptureView(ctx, deps, session.ID)
}

func (s *CatalogService) markCaptureExtractFailed(ctx context.Context, deps *captureDeps, sessionID, taskID, message string) {
	_, err := deps.repo.UpdateCaptureSession(context.WithoutCancel(ctx), sessionID, []string{domain.CaptureStatusExtracting},
		map[string]any{"status": domain.CaptureStatusFailed, "extract_error": message})
	if err != nil {
		logger.Warn(ctx, "标记窗口菜单识别失败时出错", slog.String("session_id", sessionID), slog.String("task_id", taskID), logger.Err(err))
	}
}

// ProcessCaptureExtractionTask runs inside the worker. A result for an
// outdated task (the collector re-ran recognition) is dropped.
func (s *CatalogService) ProcessCaptureExtractionTask(ctx context.Context, taskID string, payload map[string]any) (map[string]any, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSpace(fmt.Sprint(payload["session_id"]))
	session, err := deps.repo.GetCaptureSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil || session.Status != domain.CaptureStatusExtracting || pointerValue(session.ExtractTaskID) != taskID {
		return map[string]any{"session_id": sessionID, "skipped": "stale_task"}, nil
	}
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	wanted := map[string]bool{}
	for _, id := range stringSliceFromAny(payload["asset_ids"]) {
		wanted[id] = true
	}
	assetIDs, imageURLs := []string{}, []string{}
	for _, asset := range assets {
		if asset.Kind != domain.CaptureAssetMenu || (len(wanted) > 0 && !wanted[asset.ID]) || len(assetIDs) >= captureMaxMenuImages {
			continue
		}
		s.resolveCaptureAssetURL(&asset)
		assetIDs, imageURLs = append(assetIDs, asset.ID), append(imageURLs, asset.URL)
	}
	if len(assetIDs) == 0 {
		s.markCaptureExtractFailed(ctx, deps, session.ID, taskID, "没有可识别的菜单照片")
		return nil, fmt.Errorf("canteen capture session %s has no menu photos", session.ID)
	}
	extraction, err := deps.extractor.Extract(ctx, assetIDs, imageURLs)
	if err != nil {
		s.markCaptureExtractFailed(ctx, deps, session.ID, taskID, "菜单识别暂时失败，请稍后重试")
		return nil, err
	}
	extraction.Items = applyCaptureServiceMode(extraction.Items, session.ServiceMode)
	passed, exceptions := countCaptureItems(extraction.Items)
	extractionJSON, err := captureExtractionJSON(extraction)
	if err != nil {
		return nil, err
	}
	changed, err := deps.repo.UpdateCaptureSession(ctx, session.ID, []string{domain.CaptureStatusExtracting}, map[string]any{
		"status": domain.CaptureStatusExtracted, "extraction": extractionJSON, "extract_error": "",
		"menu_item_count": passed + exceptions, "exception_item_count": exceptions,
	})
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "窗口菜单识别完成", slog.String("session_id", session.ID), slog.String("task_id", taskID),
		slog.Int("passed", passed), slog.Int("exceptions", exceptions), slog.Int64("duration_ms", extraction.DurationMs), slog.Bool("saved", changed))
	return map[string]any{"session_id": session.ID, "passed": passed, "exceptions": exceptions, "saved": changed}, nil
}

// RunCaptureExtractionNow reads one session's menus in the calling process
// and settles its task row. Ops use it where no worker handles the task type
// (a local test, or a backlog after an outage); the worker path is unchanged.
func (s *CatalogService) RunCaptureExtractionNow(ctx context.Context, sessionID string) (map[string]any, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := deps.repo.GetCaptureSession(ctx, strings.TrimSpace(sessionID))
	if err != nil {
		return nil, err
	}
	if session == nil || session.Status != domain.CaptureStatusExtracting || pointerValue(session.ExtractTaskID) == "" {
		return nil, badRequest("该采集不在识别中")
	}
	taskID := pointerValue(session.ExtractTaskID)
	result, err := s.ProcessCaptureExtractionTask(ctx, taskID, map[string]any{"session_id": session.ID})
	if deps.tasks == nil {
		return result, err
	}
	if err != nil {
		_, _ = deps.tasks.FailTask(context.WithoutCancel(ctx), taskID, err.Error())
		return nil, err
	}
	if _, completeErr := deps.tasks.CompleteTask(ctx, taskID, result); completeErr != nil {
		logger.Warn(ctx, "窗口菜单识别已完成但任务状态未更新", slog.String("task_id", taskID), logger.Err(completeErr))
	}
	return result, nil
}

func countCaptureItems(items []domain.CaptureItem) (passed, exceptions int) {
	for _, item := range items {
		switch item.Status {
		case domain.CaptureItemPassed, domain.CaptureItemPublished, domain.CaptureItemKept:
			passed++
		case domain.CaptureItemException:
			exceptions++
		}
	}
	return passed, exceptions
}

func stringSliceFromAny(value any) []string {
	out := []string{}
	switch typed := value.(type) {
	case []string:
		out = append(out, typed...)
	case []any:
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
				out = append(out, text)
			}
		}
	}
	return out
}

// captureExtractionJSON encodes the extraction for a map update; GORM does not
// apply field serializers to map values.
func captureExtractionJSON(extraction *domain.CaptureExtraction) (datatypes.JSON, error) {
	data, err := json.Marshal(extraction)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(data), nil
}

func revisionEvidence(imagePaths, evidence []string) []string {
	return uniqueStrings(append(append([]string{}, imagePaths...), evidence...))
}
