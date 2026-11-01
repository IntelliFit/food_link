package service

import (
	"testing"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
)

func TestPriceAskDecision(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, shanghai)
	stale := now.Add(-90 * 24 * time.Hour)
	recent := now.Add(-10 * 24 * time.Hour)
	staleDish := repo.DishRow{InCatalog: true, PriceType: "fixed", Price: 12, PriceSetAt: &stale}
	base := func() priceAskInput {
		return priceAskInput{cohort: domain.CohortActive, dish: staleDish, now: now}
	}
	cases := []struct {
		name   string
		change func(*priceAskInput)
		ask    bool
		reason string
	}{
		{"active user, stale fixed price", func(*priceAskInput) {}, true, "ask"},
		{"contributor", func(in *priceAskInput) { in.cohort = domain.CohortContributor }, true, "ask"},
		{"regular user", func(in *priceAskInput) { in.cohort = domain.CohortRegular }, false, "cohort"},
		{"photo question already shown", func(in *priceAskInput) { in.photoAsked = true }, false, "photo_first"},
		{"not a catalog dish", func(in *priceAskInput) { in.dish.InCatalog = false }, false, "not_in_catalog"},
		{"range price", func(in *priceAskInput) { in.dish.PriceType = "range" }, false, "not_fixed_price"},
		{"by weight", func(in *priceAskInput) { in.dish.PriceType = "weight" }, false, "not_fixed_price"},
		{"fresh price", func(in *priceAskInput) { in.dish.PriceSetAt = &recent }, false, "fresh"},
		{"no price at all, even if new", func(in *priceAskInput) {
			in.dish.Price, in.dish.PriceType, in.dish.PriceSetAt = 0, "unknown", &recent
		}, true, "ask"},
		{"already asked today", func(in *priceAskInput) { in.askedToday = 1 }, false, "daily_cap"},
		{"two unanswered in a row this week", func(in *priceAskInput) {
			in.recent = []repo.PriceAsk{{AskedAt: now.Add(-48 * time.Hour), Kind: domain.PriceSkipped}, {AskedAt: now.Add(-72 * time.Hour)}}
		}, false, "cooldown"},
		{"cooldown over after a week", func(in *priceAskInput) {
			in.recent = []repo.PriceAsk{{AskedAt: now.Add(-8 * 24 * time.Hour), Kind: domain.PriceSkipped}, {AskedAt: now.Add(-9 * 24 * time.Hour)}}
		}, true, "ask"},
		{"answered last time", func(in *priceAskInput) {
			in.recent = []repo.PriceAsk{{AskedAt: now.Add(-48 * time.Hour), Kind: domain.PriceSame}, {AskedAt: now.Add(-72 * time.Hour)}}
		}, true, "ask"},
	}
	for _, tc := range cases {
		in := base()
		tc.change(&in)
		ask, reason := priceAskDecision(in)
		if ask != tc.ask || reason != tc.reason {
			t.Fatalf("%s: got (%v, %s), want (%v, %s)", tc.name, ask, reason, tc.ask, tc.reason)
		}
	}
}

func TestLocalDayStartUsesChinaTime(t *testing.T) {
	// 2026-10-27 18:30 UTC is already 10-28 02:30 in China.
	got := localDayStart(time.Date(2026, 10, 27, 18, 30, 0, 0, time.UTC))
	if want := time.Date(2026, 10, 28, 0, 0, 0, 0, shanghai); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got, want)
	}
}
