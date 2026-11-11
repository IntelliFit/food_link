package storage

import (
	"context"
	"fmt"
	"food_link/backend/pkg/config"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"strings"
	"testing"
)

type deletionTransport func(*http.Request) (*http.Response, error)

func (f deletionTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAccountDeletionObjectsStayInsideOwnedNamespace(t *testing.T) {
	id := uuid.NewString()
	other := uuid.NewString()
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	deletes := []string{}
	lists := []string{}
	http.DefaultTransport = deletionTransport(func(r *http.Request) (*http.Response, error) {
		body := ""
		if r.Method == "GET" {
			prefix := r.URL.Query().Get("prefix")
			lists = append(lists, prefix)
			require.Contains(t, []string{id + "/", "analysis-video-frames/" + id + "/", "user-feedback/" + id + "/"}, prefix)
			body = fmt.Sprintf(`<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>%sorphan.jpg</Key></Contents></ListBucketResult>`, prefix)
		} else if r.Method == "DELETE" {
			deletes = append(deletes, r.URL.Path)
			require.NotContains(t, r.URL.Path, other)
		} else {
			t.Fatalf("unexpected method %s", r.Method)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	client := New(config.StorageConfig{COSFoodImagesBucket: "food-test-1234567890", COSUserAvatarsBucket: "avatar-test-1234567890", COSHealthReportsBucket: "health-test-1234567890", COSSecretID: "test-only", COSSecretKey: "test-only"})
	require.NoError(t, client.DeleteAccountObjects(context.Background(), id))
	require.Len(t, lists, 5)
	require.Len(t, deletes, 5)
	require.Error(t, client.DeleteAccountObjects(context.Background(), "../"+other))
	require.Len(t, deletes, 5)
}

func TestAccountDeletionReferencesPreserveSharedAndSystemAssets(t *testing.T) {
	id := uuid.NewString()
	owned := uuid.NewString() + ".jpg"
	shared := uuid.NewString() + ".jpg"
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	deletes := []string{}
	http.DefaultTransport = deletionTransport(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "DELETE", r.Method)
		deletes = append(deletes, r.URL.Path)
		return &http.Response{StatusCode: 204, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	client := New(config.StorageConfig{COSFoodImagesBucket: "food-test-1234567890", COSSecretID: "test-only", COSSecretKey: "test-only", CDNFoodImagesBaseURL: "https://images.example.test"})
	require.NoError(t, client.DeleteAccountReferences(context.Background(), id, []AccountObjectRef{
		{Bucket: "food-images", Value: "https://images.example.test/" + owned},
		{Bucket: "food-images", Value: shared, Shared: true},
		{Bucket: "food-images", Value: "_system/default_avatar.jpg"},
		{Bucket: "food-images", Value: "https://untrusted.example.test/" + shared},
		{Bucket: "food-images", Value: "https://untrusted.example.test/storage/v1/object/public/food-images/" + shared},
	}))
	require.Equal(t, []string{"/" + owned}, deletes)
}
