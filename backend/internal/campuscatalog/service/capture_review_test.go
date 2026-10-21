package service

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// fakeCaptureReview models WeChat's asynchronous image check. A photo
// submitted before the window is submitted has its answer by then; a photo
// first sent at submit is still pending when the publication wait ends, and
// answered on a retry. Photos are keyed the way the real check keys them:
// user, scene and the canonical URL from ExtractContent.
type fakeCaptureReview struct {
	mu       sync.Mutex
	answered map[string]bool
	starts   int
	startErr error
	checked  []string
}

func newFakeCaptureReview() *fakeCaptureReview {
	return &fakeCaptureReview{answered: map[string]bool{}}
}

func captureReviewKeys(userID string, scene int, doc map[string]any, store *storage.Client) ([]string, error) {
	_, images, err := contentsecurity.ExtractContent(doc, store)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(images))
	for _, image := range images {
		keys = append(keys, fmt.Sprintf("%s|%d|%s", userID, scene, image))
	}
	return keys, nil
}

func (f *fakeCaptureReview) StartDocument(_ context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	keys, err := captureReviewKeys(userID, scene, doc, store)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.starts++
	if f.startErr != nil {
		return f.startErr
	}
	for _, key := range keys {
		f.answered[key] = true
	}
	return nil
}

func (f *fakeCaptureReview) CheckPublication(_ context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	keys, err := captureReviewKeys(userID, scene, doc, store)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checked = append(f.checked, keys...)
	pending := false
	for _, key := range keys {
		if !f.answered[key] {
			f.answered[key], pending = true, true
		}
	}
	if pending {
		return contentsecurity.ErrPending
	}
	return nil
}

func (f *fakeCaptureReview) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.starts
}

func (f *fakeCaptureReview) checkedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.checked)
}

// waitForStarts waits for the background review starts the uploads spawned.
func (f *fakeCaptureReview) waitForStarts(t *testing.T, want int) {
	t.Helper()
	require.Eventually(t, func() bool { return f.startCount() >= want }, 5*time.Second, 5*time.Millisecond)
	require.Equal(t, want, f.startCount())
}

func newCaptureReviewHarness(t *testing.T) (*captureHarness, *fakeCaptureReview) {
	t.Helper()
	review := newFakeCaptureReview()
	store := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.test/food"})
	return newCaptureHarnessWith(t, store, review), review
}

func TestCaptureSubmitReusesDishPhotoReviewsStartedAtUpload(t *testing.T) {
	h, review := newCaptureReviewHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-photo-1")
	view := h.extract(t, userID, session.Session.ID)
	require.Len(t, view.Items, 3)
	h.upload(t, userID, session.Session.ID, "stall", "", "", "stall-front")
	require.Zero(t, review.startCount(), "menu and stall photos are not published, so they are not reviewed")

	shengjian := captureItemByName(t, view.Items, "生煎包")
	h.upload(t, userID, session.Session.ID, "dish", shengjian.Key, "", "dish-shengjian")
	const namedDishes = 24
	for index := 0; index < namedDishes; index++ {
		h.upload(t, userID, session.Session.ID, "dish", "", fmt.Sprintf("窗口菜%d", index), fmt.Sprintf("dish-%d", index))
	}
	review.waitForStarts(t, namedDishes+1)

	submitted, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err, "every dish photo was answered before submit")
	require.Equal(t, domain.CaptureStatusSubmitted, submitted.Session.Status)
	require.Equal(t, 3+namedDishes, submitted.Session.PublishedItemCount)
	require.Equal(t, namedDishes+1, review.checkedCount(), "submit checks the same photos the uploads started")
}

func TestCaptureSubmitStillGatesWhenUploadReviewFails(t *testing.T) {
	h, review := newCaptureReviewHarness(t)
	review.startErr = contentsecurity.ErrUnavailable
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "面食")
	asset := h.upload(t, userID, session.Session.ID, "dish", "", "葱油拌面", "dish-congyou")
	require.NotEmpty(t, asset.ID, "a failed review start does not fail the upload")
	review.waitForStarts(t, 1)

	_, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.ErrorIs(t, err, contentsecurity.ErrPending)
	view, err := h.svc.GetCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, domain.CaptureStatusDraft, view.Session.Status, "nothing is published before the check passes")
	var count int64
	require.NoError(t, h.db.Model(&domain.CatalogItem{}).Where("source_channel = ?", captureSourceChannel).Count(&count).Error)
	require.Zero(t, count)

	submitted, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err, "the check submit sent is answered on retry")
	require.Equal(t, 1, submitted.Session.PublishedItemCount)
}

func TestCapturePhotoReclassifiedAsDishStartsReview(t *testing.T) {
	h, review := newCaptureReviewHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "面食")
	asset := h.upload(t, userID, session.Session.ID, "other", "", "", "photo-noodles")
	require.Zero(t, review.startCount())

	_, err := h.svc.UpdateCaptureAsset(ctx, userID, session.Session.ID, asset.ID,
		CaptureAssetInput{Kind: "dish", DishName: "葱油拌面"}, false)
	require.NoError(t, err)
	review.waitForStarts(t, 1)

	submitted, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, 1, submitted.Session.PublishedItemCount)
}
