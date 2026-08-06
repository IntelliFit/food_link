package main

import (
	"testing"

	"food_link/backend/internal/campuscatalog/domain"
	"github.com/stretchr/testify/require"
)

func TestAuditCandidatesMatchesAdminPublishGate(t *testing.T) {
	price := 12.0
	items := []domain.CatalogItem{
		{ID: "ready", Name: "鸡蛋饼", Status: "ready", PriceType: "fixed", Price: &price, MissingFields: []string{"image"}},
		{ID: "failed", Name: "咖喱炒饭", Status: "analysis_failed", PriceType: "fixed", PriceText: "4元"},
		{ID: "pending", Name: "番茄炒饭", Status: "analysis_pending", PriceType: "fixed", Price: &price},
		{ID: "published", Name: "小白菜鸡蛋", Status: "published", PriceType: "fixed", Price: &price},
		{ID: "no-price", Name: "套餐组成项", Status: "ready", PriceType: "unknown", MissingFields: []string{"price"}},
	}

	report, candidates := auditCandidates(items, "dev/db/public", false)

	require.Equal(t, 5, report.TotalItems)
	require.Equal(t, 2, report.CandidateCount)
	require.Equal(t, 1, report.BlockedCount)
	require.Equal(t, 1, report.BlockedReasons["price"])
	require.Equal(t, []string{"ready", "failed"}, []string{candidates[0].ID, candidates[1].ID})
}

func TestPublishBlockingReasonsAllowsImageOnlyMissingField(t *testing.T) {
	item := domain.CatalogItem{
		Name: "无图菜品", Status: "ready", PriceType: "freeform", PriceText: "12元/份", MissingFields: []string{"image"},
	}
	require.Empty(t, publishBlockingReasons(item))
}
