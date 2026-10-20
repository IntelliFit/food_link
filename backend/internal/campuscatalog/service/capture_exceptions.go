package service

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"log/slog"
	"sort"
	"strings"
	"unicode/utf8"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/logger"
)

// CaptureExceptionCase is everything a local agent needs to settle one
// session's exceptions: original photo URLs, both transcriptions and items.
type CaptureExceptionCase struct {
	Session domain.CaptureSession `json:"session"`
	Assets  []domain.CaptureAsset `json:"assets"`
}

func (s *CatalogService) ListCaptureExceptions(ctx context.Context, limit int) ([]CaptureExceptionCase, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	sessions, err := deps.repo.ListPendingCaptureExceptions(ctx, limit)
	if err != nil {
		return nil, err
	}
	cases := make([]CaptureExceptionCase, 0, len(sessions))
	for _, session := range sessions {
		assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
		if err != nil {
			return nil, err
		}
		for index := range assets {
			s.resolveCaptureAssetURL(&assets[index])
		}
		cases = append(cases, CaptureExceptionCase{Session: session, Assets: assets})
	}
	return cases, nil
}

// CaptureResolution settles one exception item. Fields left empty keep the
// extracted value; publish makes it a catalog item, keep stores it as window
// information only, discard drops it.
type CaptureResolution struct {
	Key          string                      `json:"key"`
	Action       string                      `json:"action"`
	Name         string                      `json:"name"`
	Prices       []float64                   `json:"prices"`
	PriceUnit    string                      `json:"price_unit"`
	Kind         string                      `json:"kind"`
	OptionGroups []domain.CaptureOptionGroup `json:"option_groups"`
	Note         string                      `json:"note"`
}

type CaptureResolveResult struct {
	SessionID       string `json:"session_id"`
	Published       int    `json:"published"`
	Kept            int    `json:"kept"`
	Discarded       int    `json:"discarded"`
	Remaining       int    `json:"remaining"`
	ExceptionStatus string `json:"exception_status"`
}

func (s *CatalogService) ResolveCaptureExceptions(ctx context.Context, sessionID, resolver string, resolutions []CaptureResolution) (*CaptureResolveResult, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	session, err := deps.repo.GetCaptureSession(ctx, strings.TrimSpace(sessionID))
	if err != nil {
		return nil, err
	}
	if session == nil || session.Status != domain.CaptureStatusSubmitted || session.Extraction == nil {
		return nil, notFound("采集记录不存在或尚未提交")
	}
	resolver = firstNonEmpty(strings.TrimSpace(resolver), domain.CaptureSourceLocalAgent)
	items := append([]domain.CaptureItem{}, session.Extraction.Items...)
	byKey := map[string]int{}
	for index, item := range items {
		byKey[item.Key] = index
	}
	result := &CaptureResolveResult{SessionID: session.ID}
	resolvedKeys := []string{}
	for _, resolution := range resolutions {
		index, ok := byKey[strings.TrimSpace(resolution.Key)]
		if !ok || items[index].Status != domain.CaptureItemException {
			continue
		}
		item, err := applyCaptureResolution(items[index], resolution, resolver)
		if err != nil {
			return nil, err
		}
		items[index] = item
		resolvedKeys = append(resolvedKeys, item.Key)
		switch item.Status {
		case domain.CaptureItemKept:
			result.Kept++
		case domain.CaptureItemDiscarded:
			result.Discarded++
		}
	}
	if len(resolvedKeys) == 0 {
		return nil, badRequest("没有匹配到待处理的条目")
	}
	assets, err := deps.repo.ListCaptureAssets(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	keyByAsset, menuKeys := map[string]string{}, []string{}
	for _, asset := range assets {
		keyByAsset[asset.ID] = asset.ObjectKey
		if asset.Kind == domain.CaptureAssetMenu {
			menuKeys = append(menuKeys, asset.ObjectKey)
		}
	}
	items, err = s.publishCaptureItems(ctx, deps, session, items, keyByAsset, menuKeys, captureResolveBatchKey(session.ID, resolvedKeys))
	if err != nil {
		return nil, err
	}
	published := 0
	for _, item := range items {
		switch item.Status {
		case domain.CaptureItemPublished:
			published++
		case domain.CaptureItemException:
			result.Remaining++
		}
	}
	for _, key := range resolvedKeys {
		if items[byKey[key]].Status == domain.CaptureItemPublished {
			result.Published++
		}
	}
	result.ExceptionStatus = domain.CaptureExceptionPending
	if result.Remaining == 0 {
		result.ExceptionStatus = domain.CaptureExceptionResolved
	}
	extraction := *session.Extraction
	extraction.Items = items
	extractionJSON, err := captureExtractionJSON(&extraction)
	if err != nil {
		return nil, err
	}
	if _, err := deps.repo.UpdateCaptureSession(ctx, session.ID, []string{domain.CaptureStatusSubmitted}, map[string]any{
		"extraction": extractionJSON, "exception_status": result.ExceptionStatus,
		"exception_item_count": result.Remaining, "published_item_count": published,
	}); err != nil {
		return nil, err
	}
	logger.Info(ctx, "窗口采集异常已处理", slog.String("session_id", session.ID), slog.String("resolver", resolver),
		slog.Int("published", result.Published), slog.Int("kept", result.Kept), slog.Int("discarded", result.Discarded), slog.Int("remaining", result.Remaining))
	return result, nil
}

func applyCaptureResolution(item domain.CaptureItem, resolution CaptureResolution, resolver string) (domain.CaptureItem, error) {
	if name := strings.TrimSpace(resolution.Name); name != "" {
		if !validCaptureName(name) || utf8.RuneCountInString(name) > 40 {
			return item, badRequest("菜名不正确：" + name)
		}
		item.Name = name
	}
	if resolution.Prices != nil {
		if !validCapturePrices(resolution.Prices) {
			return item, badRequest("价格不正确：" + item.Name)
		}
		item.Prices = sortedPrices(resolution.Prices)
		item.PriceText = ""
	}
	if unit := strings.TrimSpace(resolution.PriceUnit); unit != "" {
		item.PriceUnit = normalizeCaptureUnit(unit)
	}
	if kind := strings.TrimSpace(resolution.Kind); kind != "" {
		item.Kind = normalizeCaptureKind(kind)
	}
	if resolution.OptionGroups != nil {
		item.OptionGroups = cleanOptionGroups(resolution.OptionGroups)
	}
	if note := strings.TrimSpace(resolution.Note); note != "" {
		item.Note = note
	}
	switch strings.TrimSpace(resolution.Action) {
	case "publish":
		item.Status = domain.CaptureItemPassed
	case "keep":
		item.Status = domain.CaptureItemKept
	case "discard":
		item.Status = domain.CaptureItemDiscarded
	default:
		return item, badRequest("action 只能是 publish、keep 或 discard")
	}
	item.Source, item.ResolvedBy = domain.CaptureSourceLocalAgent, resolver
	return item, nil
}

func captureResolveBatchKey(sessionID string, keys []string) string {
	sorted := append([]string{}, keys...)
	sort.Strings(sorted)
	sum := sha1.Sum([]byte(strings.Join(sorted, ",")))
	return "capture-resolve:" + sessionID + ":" + hex.EncodeToString(sum[:])[:12]
}
