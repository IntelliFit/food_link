package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBingMediaURLFromHref(t *testing.T) {
	href := `/images/search?view=detailV2&ccid=abc&id=1&thid=OIP.x&mediaurl=https%3a%2f%2fexample.com%2fkelp.jpg&exph=100`
	assert.Equal(t, "https://example.com/kelp.jpg", bingMediaURLFromHref(href))
	legacy := "/images/search?view=detailV2&ccid=a&id=b&thid=c&mediaurl=https%3a%2f%2flegacy.com%2f1.png&exph=1"
	assert.Equal(t, "https://legacy.com/1.png", bingMediaURLFromHref(legacy))
}

func TestParseBingIuscFromSearchHTML(t *testing.T) {
	page := `<a class="iusc" href="/images/search?view=detailV2&ccid=a&id=b&thid=c&mediaurl=https%3a%2f%2ffoo.com%2fa.jpg" m="{&quot;purl&quot;:&quot;https://foo.com/page&quot;}">` +
		`<a class="iusc" href="/images/search?view=detailV2&ccid=x&id=y&thid=z&mediaurl=https%3a%2f%2fbar.com%2fb.png">`
	tiles := parseBingIuscFromSearchHTML(page)
	require.Len(t, tiles, 2)
	assert.Equal(t, "https://foo.com/a.jpg", tiles[0].ImageURL)
	assert.Equal(t, "https://foo.com/page", tiles[0].PageURL)
	assert.Equal(t, "https://bar.com/b.png", tiles[1].ImageURL)
}

func TestSearchBingImagesLive(t *testing.T) {
	if os.Getenv("BING_SEARCH_LIVE") == "" {
		t.Skip("set BING_SEARCH_LIVE=1 to run")
	}
	cands := searchBingImages("凉拌海带丝", 8, 0)
	if len(cands) < 1 {
		t.Fatalf("expected >=1 bing candidate, got %d", len(cands))
	}
	for i, c := range cands {
		t.Logf("%d image=%s page=%s", i+1, c.ImageURL, c.PageURL)
		assert.True(t, strings.HasPrefix(c.ImageURL, "http"))
		assert.False(t, strings.Contains(c.ImageURL, "bing.net/th?id=OIP"), "should use mediaurl not turl thumbnail")
	}
}

func TestSaveBingPreviewTop3(t *testing.T) {
	if os.Getenv("BING_SEARCH_LIVE") == "" {
		t.Skip("set BING_SEARCH_LIVE=1 to run")
	}
	query := "凉拌海带丝"
	cands := searchBingImages(query, 3, 0)
	require.NotEmpty(t, cands)
	dir := filepath.Join("tmp", "standard-food-image-backfill-bing-one", "preview-python-logic")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	ctx := context.Background()
	manifest := make([]string, 0, len(cands))
	for i, c := range cands {
		img, err := downloadCandidateImage(ctx, c, "bing")
		require.NoError(t, err, "download candidate %d", i+1)
		ext := img.Ext
		if ext == "" {
			ext = ".jpg"
		}
		name := fmt.Sprintf("%02d%s", i+1, ext)
		path := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(path, img.Data, 0o644))
		manifest = append(manifest, fmt.Sprintf("%d %s\n  image=%s\n  page=%s\n", i+1, name, c.ImageURL, c.PageURL))
		t.Logf("saved %s (%d bytes)", path, len(img.Data))
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.txt"), []byte(
		"query="+query+"\n\n"+strings.Join(manifest, "\n"),
	), 0o644))
}
