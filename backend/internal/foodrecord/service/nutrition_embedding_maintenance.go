package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
)

const (
	defaultNutritionEmbeddingSyncInterval = time.Minute
	defaultNutritionEmbeddingFullInterval = 24 * time.Hour
	defaultNutritionEmbeddingBatchSize    = 64
)

type nutritionEmbeddingMaintenanceRepository interface {
	ListNutritionEmbeddingSources(context.Context) ([]foodrecordrepo.NutritionEmbeddingSource, error)
	ListNutritionEmbeddingHashes(context.Context, string, int) (map[string]string, error)
	GetNutritionEmbeddingSourceRevision(context.Context) (foodrecordrepo.NutritionEmbeddingSourceRevision, error)
	TryNutritionEmbeddingSyncLock(context.Context, func(context.Context) error) (bool, error)
	TryNutritionEmbeddingIndexLoadLock(context.Context, func(context.Context) error) (bool, error)
	UpsertNutritionEmbeddings(context.Context, []domain.FoodNutritionEmbedding) error
	DeactivateNutritionEmbeddings(context.Context, []string, string, int) error
}

type pendingNutritionEmbedding struct {
	source foodrecordrepo.NutritionEmbeddingSource
	hash   string
}

type NutritionEmbeddingSyncResult struct {
	Changed      bool
	LockAcquired bool
	Generated    int
	Deactivated  int
}

// NutritionEmbeddingMaintainer reconciles the trusted canonical/alias source
// set into persisted vectors. It is asynchronous and fail-open: food writes and
// user analysis never wait for the external embedding API.
type NutritionEmbeddingMaintainer struct {
	repo         nutritionEmbeddingMaintenanceRepository
	client       nutritionEmbeddingClient
	retriever    *NutritionSemanticRetriever
	syncInterval time.Duration
	fullInterval time.Duration
	batchSize    int

	mu             sync.Mutex
	lastRevision   foodrecordrepo.NutritionEmbeddingSourceRevision
	hasRevision    bool
	lastFullSyncAt time.Time
}

func NewNutritionEmbeddingMaintainer(
	repo nutritionEmbeddingMaintenanceRepository,
	client nutritionEmbeddingClient,
	retriever *NutritionSemanticRetriever,
) *NutritionEmbeddingMaintainer {
	return &NutritionEmbeddingMaintainer{
		repo:         repo,
		client:       client,
		retriever:    retriever,
		syncInterval: defaultNutritionEmbeddingSyncInterval,
		fullInterval: defaultNutritionEmbeddingFullInterval,
		batchSize:    defaultNutritionEmbeddingBatchSize,
	}
}

func (m *NutritionEmbeddingMaintainer) Run(ctx context.Context) {
	if m == nil || m.repo == nil || m.client == nil || m.retriever == nil {
		return
	}
	warmCtx, warmCancel := context.WithTimeout(ctx, 5*time.Minute)
	if err := m.refreshIndex(warmCtx, true); err != nil && ctx.Err() == nil {
		logger.Warn(ctx, "营养向量索引后台预热失败，运行时将使用原有回退链路", logger.Err(err))
	}
	warmCancel()

	m.runCycle(ctx, true)
	ticker := time.NewTicker(m.syncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			force := m.lastFullSyncAt.IsZero() || time.Since(m.lastFullSyncAt) >= m.fullInterval
			m.mu.Unlock()
			m.runCycle(ctx, force)
		}
	}
}

func (m *NutritionEmbeddingMaintainer) runCycle(ctx context.Context, force bool) {
	cycleCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if _, err := m.SyncOnce(cycleCtx, force); err != nil && ctx.Err() == nil {
		logger.Error(ctx, "营养向量自动同步失败，稍后自动重试", err)
	}
	err := m.refreshIndex(cycleCtx, false)
	if err != nil && ctx.Err() == nil {
		logger.Warn(ctx, "营养向量内存索引刷新失败，继续使用上一版本", logger.Err(err))
	}
}

// refreshIndex serializes the memory-heavy index load across application pods.
// A pod that misses the lock keeps serving through the lexical/AI fallback and
// retries on the next maintenance cycle instead of competing for DB bandwidth.
func (m *NutritionEmbeddingMaintainer) refreshIndex(ctx context.Context, initial bool) error {
	acquired, err := m.repo.TryNutritionEmbeddingIndexLoadLock(ctx, func(lockCtx context.Context) error {
		if initial {
			return m.retriever.Warm(lockCtx)
		}
		refreshed, refreshErr := m.retriever.RefreshIfChanged(lockCtx)
		if refreshErr == nil && refreshed {
			logger.Info(lockCtx, "营养向量内存索引已自动刷新")
		}
		return refreshErr
	})
	if err != nil {
		return err
	}
	if !acquired {
		logger.Info(ctx, "营养向量索引由其他实例加载，本实例稍后重试")
	}
	return nil
}

func (m *NutritionEmbeddingMaintainer) SyncOnce(ctx context.Context, force bool) (NutritionEmbeddingSyncResult, error) {
	var result NutritionEmbeddingSyncResult
	if m == nil || m.repo == nil || m.client == nil {
		return result, fmt.Errorf("营养向量自动同步未配置")
	}
	revision, err := m.repo.GetNutritionEmbeddingSourceRevision(ctx)
	if err != nil {
		return result, fmt.Errorf("读取营养向量源版本: %w", err)
	}
	m.mu.Lock()
	unchanged := m.hasRevision && revision == m.lastRevision
	m.mu.Unlock()
	if !force && unchanged {
		return result, nil
	}

	acquired, err := m.repo.TryNutritionEmbeddingSyncLock(ctx, func(lockCtx context.Context) error {
		result.LockAcquired = true
		latestRevision, revisionErr := m.repo.GetNutritionEmbeddingSourceRevision(lockCtx)
		if revisionErr != nil {
			return fmt.Errorf("锁内读取营养向量源版本: %w", revisionErr)
		}
		sources, sourceErr := m.repo.ListNutritionEmbeddingSources(lockCtx)
		if sourceErr != nil {
			return fmt.Errorf("读取营养向量来源: %w", sourceErr)
		}
		existing, existingErr := m.repo.ListNutritionEmbeddingHashes(lockCtx, m.client.Model(), m.client.Dimensions())
		if existingErr != nil {
			return fmt.Errorf("读取已有营养向量: %w", existingErr)
		}

		activeKeys := make(map[string]struct{}, len(sources))
		pending := make([]pendingNutritionEmbedding, 0)
		for _, source := range sources {
			activeKeys[source.IdentityKey] = struct{}{}
			hash := EmbeddingContentHash(source.EmbeddingText)
			if existing[source.IdentityKey] == hash {
				continue
			}
			pending = append(pending, pendingNutritionEmbedding{source: source, hash: hash})
		}
		stale := make([]string, 0)
		for identityKey := range existing {
			if _, ok := activeKeys[identityKey]; !ok {
				stale = append(stale, identityKey)
			}
		}
		sort.Strings(stale)
		if err := m.repo.DeactivateNutritionEmbeddings(lockCtx, stale, m.client.Model(), m.client.Dimensions()); err != nil {
			return fmt.Errorf("停用过期营养向量: %w", err)
		}
		result.Deactivated = len(stale)

		sort.Slice(pending, func(i, j int) bool {
			return pending[i].source.IdentityKey < pending[j].source.IdentityKey
		})
		for start := 0; start < len(pending); start += m.batchSize {
			end := start + m.batchSize
			if end > len(pending) {
				end = len(pending)
			}
			batch := pending[start:end]
			texts := make([]string, len(batch))
			for index := range batch {
				texts[index] = batch[index].source.EmbeddingText
			}
			vectors, embedErr := embedNutritionBatchWithRetry(lockCtx, m.client, texts, 3)
			if embedErr != nil {
				return fmt.Errorf("生成营养向量批次: %w", embedErr)
			}
			now := time.Now()
			rows := make([]domain.FoodNutritionEmbedding, len(batch))
			for index, pendingRow := range batch {
				rows[index] = domain.FoodNutritionEmbedding{
					IdentityKey:         pendingRow.source.IdentityKey,
					FoodID:              pendingRow.source.FoodID,
					SourceType:          pendingRow.source.SourceType,
					SourceID:            pendingRow.source.SourceID,
					EmbeddingText:       pendingRow.source.EmbeddingText,
					ContentHash:         pendingRow.hash,
					EmbeddingModel:      m.client.Model(),
					EmbeddingDimensions: m.client.Dimensions(),
					EmbeddingBytes:      EncodeEmbedding(vectors[index]),
					IsActive:            true,
					CreatedAt:           now,
					UpdatedAt:           now,
				}
			}
			if err := m.repo.UpsertNutritionEmbeddings(lockCtx, rows); err != nil {
				return fmt.Errorf("写入营养向量批次: %w", err)
			}
			result.Generated += len(rows)
		}

		m.mu.Lock()
		m.lastRevision = latestRevision
		m.hasRevision = true
		if force {
			m.lastFullSyncAt = time.Now()
		}
		m.mu.Unlock()
		result.Changed = result.Generated > 0 || result.Deactivated > 0
		logger.Info(lockCtx, "营养向量自动同步完成",
			slog.Int("source_count", len(sources)),
			slog.Int("generated_count", result.Generated),
			slog.Int("deactivated_count", result.Deactivated),
			slog.String("embedding_model", m.client.Model()),
			slog.Int("embedding_dimensions", m.client.Dimensions()),
		)
		return nil
	})
	if err != nil {
		return result, err
	}
	if !acquired {
		return result, nil
	}
	return result, nil
}

func embedNutritionBatchWithRetry(ctx context.Context, client nutritionEmbeddingClient, texts []string, attempts int) ([][]float32, error) {
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		vectors, err := client.Embed(ctx, texts)
		if err == nil {
			return vectors, nil
		}
		lastErr = err
		if attempt == attempts {
			break
		}
		timer := time.NewTimer(time.Duration(attempt*2) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}
