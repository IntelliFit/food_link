package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
	"log/slog"
)

const (
	defaultNutritionEmbeddingTimeout = 4 * time.Second
	defaultNutritionIndexTTL         = 15 * time.Minute
	maxEmbeddingResponseBytes        = 128 << 20
)

type nutritionEmbeddingRepository interface {
	LoadNutritionEmbeddingIndex(context.Context, string, int) ([]foodrecordrepo.NutritionEmbeddingIndexRow, error)
	GetNutritionEmbeddingIndexRevision(context.Context, string, int) (foodrecordrepo.NutritionEmbeddingIndexRevision, error)
	FindNutritionFoodsByIDs(context.Context, []string) (map[string]domain.FoodNutrition, error)
}

type nutritionEmbeddingClient interface {
	Model() string
	Dimensions() int
	Embed(context.Context, []string) ([][]float32, error)
}

type OpenAIEmbeddingClient struct {
	apiKey     string
	baseURL    string
	model      string
	dimensions int
	httpClient *http.Client
}

func NewOpenAIEmbeddingClient(apiKey, baseURL, model string, dimensions int, timeout time.Duration) *OpenAIEmbeddingClient {
	if timeout <= 0 {
		timeout = defaultNutritionEmbeddingTimeout
	}
	return &OpenAIEmbeddingClient{
		apiKey:     strings.TrimSpace(apiKey),
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		model:      strings.TrimSpace(model),
		dimensions: dimensions,
		httpClient: &http.Client{Timeout: timeout},
	}
}

func (c *OpenAIEmbeddingClient) Model() string { return c.model }

func (c *OpenAIEmbeddingClient) Dimensions() int { return c.dimensions }

func (c *OpenAIEmbeddingClient) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	if c == nil || c.apiKey == "" || c.baseURL == "" || c.model == "" || c.dimensions <= 0 {
		return nil, fmt.Errorf("营养向量服务未配置")
	}
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}
	payload := map[string]any{
		"model":           c.model,
		"input":           inputs,
		"dimensions":      c.dimensions,
		"encoding_format": "float",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("编码营养向量请求: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建营养向量请求: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用营养向量服务: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxEmbeddingResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取营养向量响应: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("营养向量服务返回状态码 %d", resp.StatusCode)
	}
	var decoded struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, fmt.Errorf("解析营养向量响应: %w", err)
	}
	if len(decoded.Data) != len(inputs) {
		return nil, fmt.Errorf("营养向量数量不一致: got=%d want=%d", len(decoded.Data), len(inputs))
	}
	sort.Slice(decoded.Data, func(i, j int) bool { return decoded.Data[i].Index < decoded.Data[j].Index })
	vectors := make([][]float32, len(decoded.Data))
	for index, row := range decoded.Data {
		if len(row.Embedding) != c.dimensions {
			return nil, fmt.Errorf("营养向量维度不一致: got=%d want=%d", len(row.Embedding), c.dimensions)
		}
		vectors[index] = row.Embedding
	}
	return vectors, nil
}

type nutritionEmbeddingIndexEntry struct {
	foodID string
	vector []float32
	norm   float64
}

// NutritionSemanticRetriever performs exact cosine search over the prebuilt
// trusted-name index. Its output is candidate recall only.
type NutritionSemanticRetriever struct {
	repo     nutritionEmbeddingRepository
	client   nutritionEmbeddingClient
	indexTTL time.Duration
	mu       sync.RWMutex
	loadMu   sync.Mutex
	entries  []nutritionEmbeddingIndexEntry
	loadedAt time.Time
	revision foodrecordrepo.NutritionEmbeddingIndexRevision
}

func NewNutritionSemanticRetriever(repo nutritionEmbeddingRepository, client nutritionEmbeddingClient) *NutritionSemanticRetriever {
	return &NutritionSemanticRetriever{repo: repo, client: client, indexTTL: defaultNutritionIndexTTL}
}

// Warm loads the immutable index snapshot outside the user request path.
// SearchCandidates remains fail-safe when warm-up has not completed.
func (s *NutritionSemanticRetriever) Warm(ctx context.Context) error {
	if s == nil {
		return fmt.Errorf("营养向量检索未配置")
	}
	revision, err := s.repo.GetNutritionEmbeddingIndexRevision(ctx, s.client.Model(), s.client.Dimensions())
	if err != nil {
		return err
	}
	_, err = s.reload(ctx, false, revision)
	return err
}

// RefreshIfChanged cheaply checks the persisted index revision and swaps in a
// new immutable snapshot only when another pod or the maintenance loop wrote
// embeddings. User requests continue using the previous snapshot while reload
// is in progress.
func (s *NutritionSemanticRetriever) RefreshIfChanged(ctx context.Context) (bool, error) {
	if s == nil || s.repo == nil || s.client == nil {
		return false, fmt.Errorf("营养向量检索未配置")
	}
	revision, err := s.repo.GetNutritionEmbeddingIndexRevision(ctx, s.client.Model(), s.client.Dimensions())
	if err != nil {
		return false, err
	}
	s.mu.RLock()
	unchanged := len(s.entries) > 0 && revision == s.revision
	s.mu.RUnlock()
	if unchanged {
		return false, nil
	}
	if _, err := s.reload(ctx, true, revision); err != nil {
		return false, err
	}
	return true, nil
}

func (s *NutritionSemanticRetriever) SearchCandidates(ctx context.Context, queries []string, limit int) ([][]foodrecordrepo.SearchCandidate, error) {
	if s == nil || s.repo == nil || s.client == nil {
		return nil, fmt.Errorf("营养向量检索未配置")
	}
	if limit <= 0 {
		limit = 5
	}
	cleaned := make([]string, len(queries))
	for index, query := range queries {
		cleaned[index] = strings.TrimSpace(query)
	}
	started := time.Now()
	entries, ready := s.readySnapshot()
	if !ready {
		return nil, fmt.Errorf("营养向量索引尚未预热完成")
	}
	vectors, err := s.client.Embed(ctx, cleaned)
	if err != nil {
		return nil, err
	}
	result := make([][]foodrecordrepo.SearchCandidate, len(vectors))
	allFoodIDs := map[string]struct{}{}
	type scoredFood struct {
		foodID string
		score  float64
	}
	scoredByQuery := make([][]scoredFood, len(vectors))
	for queryIndex, vector := range vectors {
		queryNorm := vectorNorm(vector)
		bestByFood := make(map[string]float64)
		if queryNorm > 0 {
			for _, entry := range entries {
				score := cosineSimilarity(vector, queryNorm, entry.vector, entry.norm)
				if previous, exists := bestByFood[entry.foodID]; !exists || score > previous {
					bestByFood[entry.foodID] = score
				}
			}
		}
		scored := make([]scoredFood, 0, len(bestByFood))
		for foodID, score := range bestByFood {
			scored = append(scored, scoredFood{foodID: foodID, score: score})
		}
		sort.Slice(scored, func(i, j int) bool {
			if scored[i].score == scored[j].score {
				return scored[i].foodID < scored[j].foodID
			}
			return scored[i].score > scored[j].score
		})
		candidatePoolLimit := limit * 4
		if candidatePoolLimit < limit {
			candidatePoolLimit = limit
		}
		if len(scored) > candidatePoolLimit {
			scored = scored[:candidatePoolLimit]
		}
		scoredByQuery[queryIndex] = scored
		for _, row := range scored {
			allFoodIDs[row.foodID] = struct{}{}
		}
	}
	foodIDs := make([]string, 0, len(allFoodIDs))
	for foodID := range allFoodIDs {
		foodIDs = append(foodIDs, foodID)
	}
	foods, err := s.repo.FindNutritionFoodsByIDs(ctx, foodIDs)
	if err != nil {
		return nil, err
	}
	for queryIndex, scored := range scoredByQuery {
		candidates := make([]foodrecordrepo.SearchCandidate, 0, len(scored))
		for _, row := range scored {
			food, ok := foods[row.foodID]
			if !ok {
				continue
			}
			candidates = append(candidates, foodrecordrepo.SearchCandidate{
				Food:        food,
				MatchSource: "embedding_candidate",
				Score:       row.score,
			})
		}
		result[queryIndex] = foodrecordrepo.FilterNutritionCandidatesForQuery(cleaned[queryIndex], candidates, limit)
	}
	logger.Info(ctx, "营养向量候选检索完成",
		slog.Int("query_count", len(queries)),
		slog.Int("index_entry_count", len(entries)),
		slog.Int64("duration_ms", time.Since(started).Milliseconds()),
	)
	return result, nil
}

func (s *NutritionSemanticRetriever) readySnapshot() ([]nutritionEmbeddingIndexEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.entries) == 0 {
		return nil, false
	}
	return s.entries, true
}

func (s *NutritionSemanticRetriever) reload(ctx context.Context, force bool, revision foodrecordrepo.NutritionEmbeddingIndexRevision) ([]nutritionEmbeddingIndexEntry, error) {
	s.mu.RLock()
	if !force && len(s.entries) > 0 && time.Since(s.loadedAt) < s.indexTTL {
		entries := s.entries
		s.mu.RUnlock()
		return entries, nil
	}
	s.mu.RUnlock()

	s.loadMu.Lock()
	defer s.loadMu.Unlock()
	s.mu.RLock()
	if !force && len(s.entries) > 0 && time.Since(s.loadedAt) < s.indexTTL {
		entries := s.entries
		s.mu.RUnlock()
		return entries, nil
	}
	if force && len(s.entries) > 0 && revision == s.revision {
		entries := s.entries
		s.mu.RUnlock()
		return entries, nil
	}
	s.mu.RUnlock()
	rows, err := s.repo.LoadNutritionEmbeddingIndex(ctx, s.client.Model(), s.client.Dimensions())
	if err != nil {
		return nil, err
	}
	entries := make([]nutritionEmbeddingIndexEntry, 0, len(rows))
	for _, row := range rows {
		vector, decodeErr := DecodeEmbedding(row.EmbeddingBytes, s.client.Dimensions())
		if decodeErr != nil {
			continue
		}
		norm := vectorNorm(vector)
		if norm <= 0 {
			continue
		}
		entries = append(entries, nutritionEmbeddingIndexEntry{foodID: row.FoodID, vector: vector, norm: norm})
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("营养向量索引为空")
	}
	s.mu.Lock()
	s.entries = entries
	s.loadedAt = time.Now()
	s.revision = revision
	s.mu.Unlock()
	logger.Info(ctx, "营养向量索引加载完成", slog.Int("entry_count", len(entries)))
	return entries, nil
}

func EmbeddingContentHash(text string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(sum[:])
}

func EncodeEmbedding(vector []float32) []byte {
	encoded := make([]byte, len(vector)*4)
	for index, value := range vector {
		binary.LittleEndian.PutUint32(encoded[index*4:], math.Float32bits(value))
	}
	return encoded
}

func DecodeEmbedding(encoded []byte, dimensions int) ([]float32, error) {
	if dimensions <= 0 || len(encoded) != dimensions*4 {
		return nil, fmt.Errorf("invalid embedding bytes: got=%d want=%d", len(encoded), dimensions*4)
	}
	vector := make([]float32, dimensions)
	for index := range vector {
		vector[index] = math.Float32frombits(binary.LittleEndian.Uint32(encoded[index*4:]))
	}
	return vector, nil
}

func vectorNorm(vector []float32) float64 {
	var total float64
	for _, value := range vector {
		v := float64(value)
		total += v * v
	}
	return math.Sqrt(total)
}

func cosineSimilarity(left []float32, leftNorm float64, right []float32, rightNorm float64) float64 {
	if leftNorm <= 0 || rightNorm <= 0 || len(left) != len(right) {
		return 0
	}
	var dot float64
	for index, value := range left {
		dot += float64(value) * float64(right[index])
	}
	return dot / (leftNorm * rightNorm)
}
