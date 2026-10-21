package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"
)

type fakeUsers struct{ openID string }

func (f fakeUsers) FindByID(context.Context, string) (*authrepo.User, error) {
	return &authrepo.User{OpenID: f.openID}, nil
}

// fakeWechat answers the token, text and async media endpoints and hands out
// one trace per media submission, like the real API.
type fakeWechat struct {
	mu     sync.Mutex
	traces []string
}

func (f *fakeWechat) mediaTraces() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.traces...)
}

func newPublicationTestService(t *testing.T) (*Service, *fakeWechat) {
	t.Helper()
	wechat := &fakeWechat{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cgi-bin/stable_token":
			_ = json.NewEncoder(w).Encode(map[string]any{"errcode": 0, "access_token": "token", "expires_in": 7200})
		case "/wxa/msg_sec_check":
			_ = json.NewEncoder(w).Encode(map[string]any{"errcode": 0, "trace_id": "text", "result": map[string]any{"suggest": "pass", "label": 100}})
		case "/wxa/media_check_async":
			wechat.mu.Lock()
			trace := fmt.Sprintf("trace-%d", len(wechat.traces))
			wechat.traces = append(wechat.traces, trace)
			wechat.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"errcode": 0, "trace_id": trace})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	store := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { _ = store.Close() })
	return &Service{users: fakeUsers{openID: "openid-collector"}, appID: "wx-test", secret: "secret",
		prefix: "test:content-security:", client: server.Client(), baseURL: server.URL, store: store, mediaEnabled: true}, wechat
}

func publicationTestObjects() *storage.Client {
	return storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.test/food"})
}

func dishPhotoURL(index int) string {
	return fmt.Sprintf("https://cdn.example.test/food/canteen-capture/user-1/dish-%d.jpg", index)
}

func recordMediaResult(t *testing.T, svc *Service, trace, suggest string) {
	t.Helper()
	zero := 0
	require.NoError(t, svc.RecordMediaResult(context.Background(), APIResponse{ErrCode: &zero, TraceID: trace, Result: Result{Suggest: suggest, Label: 100}}))
}

// A window's dish photos are each started at upload; by submit the callbacks
// have arrived, so the publication check passes at once and resends nothing.
func TestCheckPublicationReusesImageChecksStartedAtUpload(t *testing.T) {
	svc, wechat := newPublicationTestService(t)
	ctx := context.Background()
	objects := publicationTestObjects()
	const photos = 40
	for index := 0; index < photos; index++ {
		require.NoError(t, svc.StartDocument(ctx, "user-1", 3, map[string]any{"image_paths": []string{dishPhotoURL(index)}}, objects))
	}
	traces := wechat.mediaTraces()
	require.Len(t, traces, photos)
	for _, trace := range traces {
		recordMediaResult(t, svc, trace, "pass")
	}

	entries := make([]any, 0, photos)
	for index := 0; index < photos; index++ {
		entries = append(entries, map[string]any{"name": fmt.Sprintf("窗口菜%d", index), "image_paths": []string{dishPhotoURL(index)}})
	}
	started := time.Now()
	require.NoError(t, svc.CheckPublication(ctx, "user-1", 3, map[string]any{"entries": entries}, objects))
	require.Less(t, time.Since(started), time.Second, "answers already recorded need no wait")
	require.Len(t, wechat.mediaTraces(), photos, "submit reuses the upload's checks")
}

func TestCheckDocumentStillGatesUnstartedAndRejectedPhotos(t *testing.T) {
	svc, wechat := newPublicationTestService(t)
	ctx := context.Background()
	objects := publicationTestObjects()
	for index := 0; index < 2; index++ {
		require.NoError(t, svc.StartDocument(ctx, "user-1", 3, map[string]any{"image_paths": []string{dishPhotoURL(index)}}, objects))
	}
	traces := wechat.mediaTraces()
	require.Len(t, traces, 2)
	recordMediaResult(t, svc, traces[0], "pass")
	recordMediaResult(t, svc, traces[1], "risky")

	err := svc.CheckDocument(ctx, "user-1", 3, map[string]any{"image_paths": []string{dishPhotoURL(0), dishPhotoURL(2)}}, objects)
	require.ErrorIs(t, err, ErrPending, "a photo first seen at submit waits for its own answer")
	require.Len(t, wechat.mediaTraces(), 3)

	err = svc.CheckDocument(ctx, "user-1", 3, map[string]any{"image_paths": []string{dishPhotoURL(0), dishPhotoURL(1)}}, objects)
	require.ErrorIs(t, err, ErrRejected)

	err = svc.CheckDocument(ctx, "user-1", 4, map[string]any{"image_paths": []string{dishPhotoURL(0)}}, objects)
	require.ErrorIs(t, err, ErrPending, "a check is reused only for the same scene")
}
