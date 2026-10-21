package service

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/logger"
)

const captureSourceChannel = "canteen_capture"

// CaptureItemView is an item as the collector sees it, with dish photo URLs.
type CaptureItemView struct {
	domain.CaptureItem
	DishPhotoURLs []string `json:"dish_photo_urls"`
}

// CaptureSessionView bundles a session for the capture page. Raw model
// transcriptions stay server-side.
type CaptureSessionView struct {
	Session domain.CaptureSession `json:"session"`
	Assets  []domain.CaptureAsset `json:"assets"`
	Items   []CaptureItemView     `json:"items"`
	Reward  CaptureRewardEstimate `json:"reward"`
}

func (s *CatalogService) GetCaptureSession(ctx context.Context, userID, sessionID string) (*CaptureSessionView, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := s.loadOwnedCaptureSession(ctx, deps, userID, sessionID)
	if err != nil {
		return nil, err
	}
	return s.buildCaptureView(ctx, deps, session)
}

func (s *CatalogService) reloadCaptureView(ctx context.Context, deps *captureDeps, sessionID string) (*CaptureSessionView, error) {
	session, err := deps.repo.GetCaptureSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, notFound("采集记录不存在")
	}
	return s.buildCaptureView(ctx, deps, session)
}

func (s *CatalogService) buildCaptureView(ctx context.Context, deps *captureDeps, session *domain.CaptureSession) (*CaptureSessionView, error) {
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	urlByID := map[string]string{}
	for index := range assets {
		s.resolveCaptureAssetURL(&assets[index])
		urlByID[assets[index].ID] = assets[index].URL
	}
	items := captureItemsWithPhotos(session, assets)
	views := make([]CaptureItemView, 0, len(items))
	sellable, photographed := 0, 0
	for _, item := range items {
		view := CaptureItemView{CaptureItem: item, DishPhotoURLs: []string{}}
		for _, id := range item.DishAssetIDs {
			if url := urlByID[id]; url != "" {
				view.DishPhotoURLs = append(view.DishPhotoURLs, url)
			}
		}
		if captureSellable(item) {
			sellable++
			if len(item.DishAssetIDs) > 0 {
				photographed++
			}
		}
		views = append(views, view)
	}
	view := &CaptureSessionView{Session: *session, Assets: assets, Items: views,
		Reward: s.captureRewardForView(ctx, deps, session, sellable, photographed)}
	view.Session.Extraction = nil
	return view, nil
}

// captureRewardForView shows the recorded reward after submit, and before it
// an estimate that already accounts for a window someone else was paid for.
func (s *CatalogService) captureRewardForView(ctx context.Context, deps *captureDeps, session *domain.CaptureSession, sellable, photographed int) CaptureRewardEstimate {
	if entry, err := deps.repo.FindLedgerBySourceKey(ctx, "window_reward:"+session.ID); err == nil && entry != nil {
		return captureEstimateFromLedger(deps.rules, entry, sellable, photographed)
	}
	if sellable == 0 {
		return deps.rules.estimate(CaptureRewardNoItems, sellable, photographed)
	}
	if session.Status == domain.CaptureStatusSubmitted {
		return deps.rules.estimate(CaptureRewardWindowTaken, sellable, photographed)
	}
	if taken, err := deps.repo.WindowRewardTaken(ctx, session.WindowKey); err == nil && taken {
		return deps.rules.estimate(CaptureRewardWindowTaken, sellable, photographed)
	}
	return deps.rules.estimate(CaptureRewardEligible, sellable, photographed)
}

func captureSellable(item domain.CaptureItem) bool {
	return item.Kind != domain.CaptureKindIngredient && item.Status != domain.CaptureItemDiscarded
}

// captureItemsWithPhotos merges the extraction with dish photos: a photo bound
// to an item key attaches to that item, a photo with only a dish name becomes
// (or joins) a collector-named item. Submitted sessions keep their snapshot.
func captureItemsWithPhotos(session *domain.CaptureSession, assets []domain.CaptureAsset) []domain.CaptureItem {
	items := []domain.CaptureItem{}
	if session.Extraction != nil {
		for _, item := range session.Extraction.Items {
			copied := item
			copied.AssetIDs = append([]string{}, item.AssetIDs...)
			if session.Status != domain.CaptureStatusSubmitted {
				copied.DishAssetIDs = []string{}
			} else {
				copied.DishAssetIDs = append([]string{}, item.DishAssetIDs...)
			}
			items = append(items, copied)
		}
	}
	if session.Status == domain.CaptureStatusSubmitted {
		return items
	}
	byKey, byName := map[string]int{}, map[string]int{}
	for index, item := range items {
		byKey[item.Key] = index
		byName[normalizeCaptureText(item.Name)] = index
	}
	for _, asset := range assets {
		if asset.Kind != domain.CaptureAssetDish {
			continue
		}
		if index, ok := byKey[asset.ItemKey]; ok && asset.ItemKey != "" {
			items[index].DishAssetIDs = append(items[index].DishAssetIDs, asset.ID)
			continue
		}
		name := strings.TrimSpace(asset.DishName)
		if name == "" || utf8.RuneCountInString(name) > 40 {
			continue
		}
		if index, ok := byName[normalizeCaptureText(name)]; ok {
			items[index].DishAssetIDs = append(items[index].DishAssetIDs, asset.ID)
			continue
		}
		added := domain.CaptureItem{
			Kind: domain.CaptureKindDish, Name: name, Status: domain.CaptureItemPassed,
			Source: domain.CaptureSourceCollector, DishAssetIDs: []string{asset.ID},
		}
		added.Key = captureItemKey(added.Name, nil)
		byKey[added.Key] = len(items)
		byName[normalizeCaptureText(name)] = len(items)
		items = append(items, added)
	}
	return items
}

// SubmitCaptureSession publishes what can be trusted, keeps the rest for the
// exception queue and records the window reward. Retrying is safe: the batch
// and the reward are both keyed by the session.
func (s *CatalogService) SubmitCaptureSession(ctx context.Context, userID, sessionID string) (*CaptureSessionView, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := s.loadOwnedCaptureSession(ctx, deps, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status == domain.CaptureStatusSubmitted {
		return s.buildCaptureView(ctx, deps, session)
	}
	if session.Status == domain.CaptureStatusExtracting {
		return nil, badRequest("菜单还在识别中，请稍候再提交")
	}
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	if session.Status != domain.CaptureStatusExtracted && hasCaptureMenuPhoto(assets) {
		return nil, badRequest("请先完成菜单识别再提交")
	}
	items := captureItemsWithPhotos(session, assets)
	if len(items) == 0 {
		return nil, badRequest("还没有可提交的菜品：请拍菜单并识别，或给实物照写上菜名")
	}
	keyByAsset, menuKeys, hashes := map[string]string{}, []string{}, []string{}
	for _, asset := range assets {
		keyByAsset[asset.ID] = asset.ObjectKey
		hashes = append(hashes, asset.ContentSHA256)
		if asset.Kind == domain.CaptureAssetMenu {
			menuKeys = append(menuKeys, asset.ObjectKey)
		}
	}
	items, err = s.publishCaptureItems(ctx, deps, session, items, keyByAsset, menuKeys, "capture:"+session.ID)
	if err != nil {
		return nil, err
	}
	sellable, photographed, published, exceptions := 0, 0, 0, 0
	for _, item := range items {
		if captureSellable(item) {
			sellable++
			if len(item.DishAssetIDs) > 0 {
				photographed++
			}
		}
		switch item.Status {
		case domain.CaptureItemPublished:
			published++
		case domain.CaptureItemException:
			exceptions++
		}
	}
	s.recordCaptureReward(ctx, deps, session, hashes, sellable, photographed)
	extraction := session.Extraction
	if extraction == nil {
		extraction = &domain.CaptureExtraction{Version: 1}
	}
	extraction.Items = items
	extractionJSON, err := captureExtractionJSON(extraction)
	if err != nil {
		return nil, err
	}
	exceptionStatus := domain.CaptureExceptionNone
	if exceptions > 0 {
		exceptionStatus = domain.CaptureExceptionPending
	}
	now := time.Now()
	updates := map[string]any{
		"status": domain.CaptureStatusSubmitted, "extraction": extractionJSON, "submitted_at": now,
		"exception_status": exceptionStatus, "menu_item_count": len(items), "published_item_count": published,
		"exception_item_count": exceptions, "photo_item_count": photographed,
	}
	if _, err := deps.repo.UpdateCaptureSession(ctx, session.ID,
		[]string{domain.CaptureStatusDraft, domain.CaptureStatusExtracted, domain.CaptureStatusFailed}, updates); err != nil {
		return nil, err
	}
	logger.Info(ctx, "窗口采集已提交", slog.String("session_id", session.ID), slog.String("user_id", session.UserID),
		slog.Int("published", published), slog.Int("exceptions", exceptions), slog.Int("photo_items", photographed))
	return s.reloadCaptureView(ctx, deps, session.ID)
}

func hasCaptureMenuPhoto(assets []domain.CaptureAsset) bool {
	for _, asset := range assets {
		if asset.Kind == domain.CaptureAssetMenu {
			return true
		}
	}
	return false
}

// publishCaptureItems creates catalog items for the passed sellable items in
// one idempotent batch. Passed ingredient lines are kept as window pricing
// evidence instead of being listed as dishes.
func (s *CatalogService) publishCaptureItems(ctx context.Context, deps *captureDeps, session *domain.CaptureSession, items []domain.CaptureItem, keyByAsset map[string]string, menuKeys []string, batchKey string) ([]domain.CaptureItem, error) {
	entries, indexes := []CreateCatalogItemInput{}, []int{}
	for index := range items {
		item := &items[index]
		if item.Status != domain.CaptureItemPassed {
			continue
		}
		if item.Kind == domain.CaptureKindIngredient {
			item.Status = domain.CaptureItemKept
			continue
		}
		if deps.rules.DisableAutoPublish && item.Source == domain.CaptureSourceModel {
			item.Status, item.Reasons = domain.CaptureItemException, uniqueStrings(append(item.Reasons, "AUTO_PUBLISH_OFF"))
			continue
		}
		entry := captureCatalogEntry(*item, keyByAsset, menuKeys)
		if entry.ServiceMode == "" && session.ServiceMode != "unknown" && session.ServiceMode != "" {
			entry.ServiceMode = session.ServiceMode
		}
		entries = append(entries, entry)
		indexes = append(indexes, index)
	}
	if len(entries) == 0 {
		return items, nil
	}
	input := CreateBatchInput{
		ClientBatchKey: batchKey, VenueType: session.VenueType,
		SchoolID: session.SchoolID, CampusID: session.CampusID, CanteenID: session.CanteenID,
		OrganizationName: session.OrganizationName, AreaName: session.AreaName, CanteenName: session.CanteenName,
		DefaultFloor: session.Floor, DefaultWindowName: session.WindowName, CapturedAt: session.CreatedAt,
		SourceNote: "窗口采集 " + session.ID, Entries: entries,
	}
	if err := s.checkCapturePublication(ctx, deps, session.UserID, entries); err != nil {
		return nil, err
	}
	actor := batchActor{UserID: session.UserID, SourceChannel: captureSourceChannel, AllowNoImage: true,
		SkipNutrition: map[string]bool{"combo": true}}
	result, err := s.createBatch(ctx, actor, input)
	if err != nil {
		return nil, err
	}
	catalogByName := map[string]string{}
	for _, created := range result.Items {
		catalogByName[normalizeCaptureText(created.Name)] = created.ID
	}
	for _, index := range indexes {
		if id := catalogByName[normalizeCaptureText(items[index].Name)]; id != "" {
			items[index].CatalogItemID, items[index].Status = id, domain.CaptureItemPublished
		}
	}
	if session.BatchID == nil {
		_, _ = deps.repo.UpdateCaptureSession(ctx, session.ID, nil, map[string]any{"batch_id": result.Batch.ID})
	}
	return items, nil
}

// checkCapturePublication sends the names and dish photos that are about to go
// public through the same content check as the other upload endpoints.
func (s *CatalogService) checkCapturePublication(ctx context.Context, deps *captureDeps, userID string, entries []CreateCatalogItemInput) error {
	if deps.publication == nil {
		return nil
	}
	docEntries := make([]any, 0, len(entries))
	for _, entry := range entries {
		images := entry.ImagePaths
		if s.storage != nil {
			images = s.storage.ResolveReferenceURLs("food-images", images)
		}
		docEntries = append(docEntries, map[string]any{"name": entry.Name, "notes": entry.Notes, "image_paths": images})
	}
	return deps.publication.CheckPublication(ctx, userID, 3, map[string]any{"entries": docEntries}, s.storage)
}

func captureCatalogEntry(item domain.CaptureItem, keyByAsset map[string]string, menuKeys []string) CreateCatalogItemInput {
	entry := CreateCatalogItemInput{
		Name: item.Name, PriceUnit: item.PriceUnit, Notes: item.Note,
		RawText:   strings.TrimSpace(item.Name + " " + firstNonEmpty(item.PriceText, formatCapturePrices(item.Prices))),
		PriceText: firstNonEmpty(item.PriceText, formatCapturePrices(item.Prices)), PriceOptions: map[string]any{},
	}
	for _, id := range item.DishAssetIDs {
		if key := keyByAsset[id]; key != "" && len(entry.ImagePaths) < maxImagesPerItem {
			entry.ImagePaths = append(entry.ImagePaths, key)
		}
	}
	for _, id := range item.AssetIDs {
		if key := keyByAsset[id]; key != "" {
			entry.EvidenceImagePaths = append(entry.EvidenceImagePaths, key)
		}
	}
	if len(entry.EvidenceImagePaths) == 0 && item.Source == domain.CaptureSourceModel {
		entry.EvidenceImagePaths = append(entry.EvidenceImagePaths, menuKeys...)
	}
	switch {
	case item.Kind == domain.CaptureKindCombo:
		entry.EntryType, entry.ServiceMode = "combo", "combo"
	case len(entry.ImagePaths) > 0:
		entry.EntryType = "dish"
	default:
		entry.EntryType = "menu_item"
	}
	entry.ImageKind = "dish"
	if len(entry.ImagePaths) == 0 {
		entry.ImageKind = "menu_board"
	}
	switch len(item.Prices) {
	case 0:
		entry.PriceType = "unknown"
	case 1:
		price := item.Prices[0]
		entry.PriceType, entry.Price = "fixed", &price
	default:
		low, high := item.Prices[0], item.Prices[len(item.Prices)-1]
		entry.PriceType, entry.PriceMin, entry.PriceMax = "range", &low, &high
		entry.PriceOptions["tiers"] = item.Prices
		entry.PriceOptions["tier_spec"] = "未标明"
	}
	if item.Kind == domain.CaptureKindCombo {
		entry.PriceType = "combo"
		if len(item.OptionGroups) > 0 {
			entry.PriceOptions["option_groups"] = item.OptionGroups
		}
	}
	return entry
}
