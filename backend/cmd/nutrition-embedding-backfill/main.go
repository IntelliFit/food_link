package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	foodrecordservice "food_link/backend/internal/foodrecord/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

type pendingSource struct {
	source foodrecordrepo.NutritionEmbeddingSource
	hash   string
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing app/config bootstrap")
	apply := flag.Bool("apply", false, "write generated embeddings; without this flag only print the plan")
	batchSize := flag.Int("batch-size", 100, "texts per embeddings request")
	concurrency := flag.Int("concurrency", 4, "parallel embeddings requests")
	timeout := flag.Duration("request-timeout", 30*time.Second, "timeout for each embeddings request")
	modelOverride := flag.String("model", "", "embedding model override")
	dimensionsOverride := flag.Int("dimensions", 0, "embedding dimensions override")
	baseURLOverride := flag.String("base-url", "", "embedding API base URL override")
	probeQueries := flag.String("probe-queries", "", "comma-separated queries for a read-only semantic retrieval probe")
	flag.Parse()
	if *batchSize <= 0 || *batchSize > 500 {
		log.Fatal("--batch-size 必须在 1 到 500 之间")
	}
	if *concurrency <= 0 || *concurrency > 16 {
		log.Fatal("--concurrency 必须在 1 到 16 之间")
	}

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	apiKey := strings.TrimSpace(os.Getenv("NUTRITION_EMBEDDING_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.External.NutritionEmbeddingAPIKey)
	}
	baseURL := firstNonEmpty(*baseURLOverride, cfg.External.NutritionEmbeddingBaseURL, "https://yunwu.ai/v1")
	model := firstNonEmpty(*modelOverride, cfg.External.NutritionEmbeddingModel, "text-embedding-3-large")
	dimensions := *dimensionsOverride
	if dimensions <= 0 {
		dimensions = cfg.External.NutritionEmbeddingDimensions
	}
	if dimensions <= 0 {
		dimensions = 1024
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	repo := foodrecordrepo.NewFoodNutritionRepo(db)
	sources, err := repo.ListNutritionEmbeddingSources(ctx)
	if err != nil {
		log.Fatalf("读取营养名称失败: %v", err)
	}
	existing, err := repo.ListNutritionEmbeddingHashes(ctx, model, dimensions)
	if err != nil {
		log.Fatalf("读取已有营养向量失败: %v", err)
	}
	pending := make([]pendingSource, 0, len(sources))
	for _, source := range sources {
		hash := foodrecordservice.EmbeddingContentHash(source.EmbeddingText)
		if existing[source.IdentityKey] == hash {
			continue
		}
		pending = append(pending, pendingSource{source: source, hash: hash})
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].source.IdentityKey < pending[j].source.IdentityKey })
	log.Printf("营养向量回填计划: source_total=%d current=%d pending=%d model=%s dimensions=%d batch_size=%d concurrency=%d apply=%t",
		len(sources), len(sources)-len(pending), len(pending), model, dimensions, *batchSize, *concurrency, *apply)
	if strings.TrimSpace(*probeQueries) != "" {
		if apiKey == "" {
			log.Fatal("缺少 NUTRITION_EMBEDDING_API_KEY")
		}
		queries := splitNonEmpty(*probeQueries)
		client := foodrecordservice.NewOpenAIEmbeddingClient(apiKey, baseURL, model, dimensions, *timeout)
		retriever := foodrecordservice.NewNutritionSemanticRetriever(repo, client)
		probeCtx, probeCancel := context.WithTimeout(ctx, *timeout)
		results, probeErr := retriever.SearchCandidates(probeCtx, queries, 5)
		probeCancel()
		if probeErr != nil {
			log.Fatalf("营养向量检索探针失败: %v", probeErr)
		}
		for index, query := range queries {
			if index >= len(results) {
				continue
			}
			for rank, candidate := range results[index] {
				log.Printf("营养向量探针: query=%q rank=%d food_id=%s canonical_name=%q score=%.6f source=%s",
					query, rank+1, candidate.Food.ID, candidate.Food.CanonicalName, candidate.Score, candidate.MatchSource)
			}
		}
		if !*apply {
			return
		}
	}
	if !*apply || len(pending) == 0 {
		return
	}
	if apiKey == "" {
		log.Fatal("缺少 NUTRITION_EMBEDDING_API_KEY")
	}
	client := foodrecordservice.NewOpenAIEmbeddingClient(apiKey, baseURL, model, dimensions, *timeout)

	type batch struct {
		index int
		rows  []pendingSource
	}
	batches := make(chan batch)
	errCh := make(chan error, *concurrency)
	var completed atomic.Int64
	var wg sync.WaitGroup
	for worker := 0; worker < *concurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range batches {
				if ctx.Err() != nil {
					return
				}
				texts := make([]string, len(item.rows))
				for index, row := range item.rows {
					texts[index] = row.source.EmbeddingText
				}
				vectors, embedErr := embedWithRetry(ctx, client, texts, 6)
				if embedErr != nil {
					select {
					case errCh <- fmt.Errorf("batch %d: %w", item.index, embedErr):
					default:
					}
					cancel()
					return
				}
				rows := make([]domain.FoodNutritionEmbedding, len(item.rows))
				now := time.Now()
				for index, source := range item.rows {
					rows[index] = domain.FoodNutritionEmbedding{
						IdentityKey:         source.source.IdentityKey,
						FoodID:              source.source.FoodID,
						SourceType:          source.source.SourceType,
						SourceID:            source.source.SourceID,
						EmbeddingText:       source.source.EmbeddingText,
						ContentHash:         source.hash,
						EmbeddingModel:      model,
						EmbeddingDimensions: dimensions,
						EmbeddingBytes:      foodrecordservice.EncodeEmbedding(vectors[index]),
						IsActive:            true,
						CreatedAt:           now,
						UpdatedAt:           now,
					}
				}
				if upsertErr := repo.UpsertNutritionEmbeddings(ctx, rows); upsertErr != nil {
					select {
					case errCh <- fmt.Errorf("batch %d write: %w", item.index, upsertErr):
					default:
					}
					cancel()
					return
				}
				done := completed.Add(int64(len(rows)))
				log.Printf("营养向量回填进度: completed=%d total=%d", done, len(pending))
			}
		}()
	}
dispatch:
	for start, batchIndex := 0, 0; start < len(pending); start, batchIndex = start+*batchSize, batchIndex+1 {
		end := start + *batchSize
		if end > len(pending) {
			end = len(pending)
		}
		select {
		case batches <- batch{index: batchIndex, rows: pending[start:end]}:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(batches)
	wg.Wait()
	close(errCh)
	for workerErr := range errCh {
		if workerErr != nil {
			log.Fatalf("营养向量回填失败: completed=%d error=%v", completed.Load(), workerErr)
		}
	}
	if ctx.Err() != nil {
		log.Fatalf("营养向量回填中止: completed=%d error=%v", completed.Load(), ctx.Err())
	}
	log.Printf("营养向量回填完成: completed=%d model=%s dimensions=%d", completed.Load(), model, dimensions)
}

func embedWithRetry(ctx context.Context, client *foodrecordservice.OpenAIEmbeddingClient, texts []string, attempts int) ([][]float32, error) {
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
		delay := time.Duration(5*(1<<(attempt-1))) * time.Second
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func splitNonEmpty(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
