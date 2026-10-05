package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"food_link/backend/pkg/storage"
	"github.com/redis/go-redis/v9"
)

const (
	ApprovalKey = "_content_security_approval"
	WaitingKey  = "_content_security_waiting"
)

// ConfigureAnalysis is called once during application wiring, before serving.
func (s *Service) ConfigureAnalysis(reader func(context.Context, string, string) (map[string]any, error), resume func(context.Context, string) error) {
	s.approvalReader, s.mediaResultHandler = reader, resume
}

// StartDocument submits media immediately; pending is a normal async state.
func (s *Service) StartDocument(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	err := s.CheckDocument(ctx, userID, scene, doc, store)
	if errors.Is(err, ErrPending) {
		return nil
	}
	return err
}

// WatchDocument connects a signed callback to a persisted task across replicas.
func (s *Service) WatchDocument(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client, taskID string) error {
	_, images, err := ExtractContent(doc, store)
	if err != nil || len(images) == 0 {
		return err
	}
	openID, err := s.Identity(ctx, userID)
	if err != nil || s.store == nil {
		return ErrUnavailable
	}
	// A concurrent upload/worker can hold the submission lock before its trace
	// has been written. Wait for that ticket instead of failing a normal pending
	// state. This wait is bounded by both the task context and API timeouts.
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	for _, mediaURL := range images {
		traceID, err := s.watchableMediaTrace(ctx, s.mediaKey(openID, scene, mediaURL))
		if err != nil {
			return ErrUnavailable
		}
		key := s.prefix + "watchers:" + traceID
		pipe := s.store.TxPipeline()
		pipe.SAdd(ctx, key, taskID)
		pipe.Expire(ctx, key, time.Hour)
		if _, err := pipe.Exec(ctx); err != nil {
			return ErrUnavailable
		}
	}
	return nil
}

func (s *Service) watchableMediaTrace(ctx context.Context, key string) (string, error) {
	for {
		traceID, err := s.store.Get(ctx, key).Result()
		if err == nil && strings.TrimSpace(traceID) != "" {
			return traceID, nil
		}
		if err != nil && !errors.Is(err, redis.Nil) {
			return "", err
		}
		locked, err := s.store.Exists(ctx, key+":lock").Result()
		if err != nil || locked == 0 {
			// Re-read after the lock check: submission writes the ticket before
			// releasing the lock, potentially between our two Redis reads.
			traceID, err = s.store.Get(ctx, key).Result()
			if err == nil && strings.TrimSpace(traceID) != "" {
				return traceID, nil
			}
			return "", ErrUnavailable
		}
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
	}
}

func (s *Service) Approval(userID, taskID string, doc map[string]any, store *storage.Client) (map[string]any, error) {
	texts, images, err := ExtractContent(doc, store)
	if err != nil {
		return nil, err
	}
	approval := map[string]any{"version": 1, "texts": texts, "images": images}
	if s.secret == "" {
		return nil, ErrUnavailable
	}
	approval["mac"] = s.approvalMAC(userID, taskID, texts, images)
	return approval, nil
}

func (s *Service) approvalMAC(userID, taskID string, texts, images []string) string {
	// Domain-separated, canonical receipt. Bind it to the owner/task; batch or
	// legacy result-write endpoints cannot mint receipts using client JSON.
	raw, _ := json.Marshal([]any{"foodlink-content-security-v1", s.appID, userID, taskID, texts, images})
	mac := hmac.New(sha256.New, []byte(s.secret))
	_, _ = mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Service) trustedApproval(userID, taskID string, approval map[string]any) bool {
	if s.secret == "" || (approval["version"] != 1 && approval["version"] != float64(1)) {
		return false
	}
	provided, _ := approval["mac"].(string)
	if provided == "" {
		return false
	}
	return hmac.Equal([]byte(provided), []byte(s.approvalMAC(userID, taskID, approvalStrings(approval["texts"]), approvalStrings(approval["images"]))))
}

func approvalStrings(raw any) []string {
	result := []string{}
	switch values := raw.(type) {
	case []string:
		return values
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

func subtractApproved(values []string, raw any) []string {
	approved := make(map[string]bool)
	switch v := raw.(type) {
	case []string:
		for _, value := range v {
			approved[value] = true
		}
	case []any:
		for _, value := range v {
			if text, ok := value.(string); ok {
				approved[text] = true
			}
		}
	}
	remaining := make([]string, 0, len(values))
	for _, value := range values {
		if !approved[value] {
			remaining = append(remaining, value)
		}
	}
	return remaining
}
