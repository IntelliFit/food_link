package main

import (
	"os"
	"testing"
)

func TestSearchGoogleImagesLive(t *testing.T) {
	if os.Getenv("GOOGLE_SEARCH_LIVE") == "" {
		t.Skip("set GOOGLE_SEARCH_LIVE=1 to run")
	}
	opencli := searchGoogleImagesOpenCLI("apple food photo", 5)
	t.Logf("opencli_candidates=%d", len(opencli))
	candidates := searchGoogleImages("apple food photo", 5)
	if len(candidates) == 0 {
		t.Fatal("expected google image candidates (set GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX for Custom Search API)")
	}
	t.Logf("first=%s", candidates[0].ImageURL)
}
