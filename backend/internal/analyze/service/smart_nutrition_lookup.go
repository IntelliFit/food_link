package service

import (
	"context"
	"log/slog"
	"sync"

	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
)

// nutritionBatchResolver resolves many names with ResolveFood's exact rules
// in a fixed number of queries.
type nutritionBatchResolver interface {
	ResolveFoods(context.Context, []string) (map[string]*foodrecordrepo.ResolveResult, error)
}

// smartRun is one meal's library pass. Every exact-name query the meal can
// need is fetched up front in one batch; matching then runs in memory.
type smartRun struct {
	s     *AnalyzeService
	mu    sync.RWMutex
	cache map[string]*foodrecordrepo.ResolveResult
}

func (s *AnalyzeService) newSmartRun(ctx context.Context, items []map[string]any) *smartRun {
	run := &smartRun{s: s, cache: map[string]*foodrecordrepo.ResolveResult{}}
	batch, ok := s.nutrition.(nutritionBatchResolver)
	if !ok {
		return run
	}
	queries := smartPrefetchQueries(items)
	if len(queries) == 0 {
		return run
	}
	results, err := batch.ResolveFoods(ctx, queries)
	if err != nil {
		logger.Warn(ctx, "智能营养匹配批量查库失败，改为逐项查询", logger.Err(err), slog.Int("query_count", len(queries)))
		return run
	}
	run.cache = results
	return run
}

func (r *smartRun) resolveFood(ctx context.Context, query string) (*foodrecordrepo.ResolveResult, error) {
	r.mu.RLock()
	cached, ok := r.cache[query]
	r.mu.RUnlock()
	if ok {
		return cached, nil
	}
	result, err := r.s.nutrition.ResolveFood(ctx, query)
	if err == nil {
		r.mu.Lock()
		r.cache[query] = result
		r.mu.Unlock()
	}
	return result, err
}

// smartPrefetchQueries lists every exact-name query the matching rules may
// try for these items, including dish ingredients and cooking-fat fallbacks.
func smartPrefetchQueries(items []map[string]any) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(queries ...string) {
		for _, query := range queries {
			if query != "" && !seen[query] {
				seen[query] = true
				out = append(out, query)
			}
		}
	}
	for _, item := range items {
		if smartItemKindOf(item) != smartKindPackaged || !smartHasPackagedIdentity(item) {
			add(smartSingleFoodQueries(item, stringFromAny(item["name"]))...)
		}
		for _, component := range smartDishComponents(item) {
			if smartIsCookingFat(component.name) {
				add(append([]string{component.name}, smartCookingFatFallbacks...)...)
				continue
			}
			add(smartSingleFoodQueries(smartComponentItem(component), component.name)...)
		}
	}
	return out
}
