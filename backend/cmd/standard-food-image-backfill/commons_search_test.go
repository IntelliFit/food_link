package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCommonsSearchUsesImageInfoAndFiltersLicenses(t *testing.T) {
	var requestSeen bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestSeen = true
		query := r.URL.Query()
		assert.Equal(t, "query", query.Get("action"))
		assert.Equal(t, "json", query.Get("format"))
		assert.Equal(t, "2", query.Get("formatversion"))
		assert.Equal(t, "search", query.Get("generator"))
		assert.Equal(t, "black soybeans", query.Get("gsrsearch"))
		assert.Equal(t, "6", query.Get("gsrnamespace"))
		assert.Equal(t, "10", query.Get("gsrlimit"))
		assert.Equal(t, "imageinfo", query.Get("prop"))
		assert.Equal(t, "url|extmetadata", query.Get("iiprop"))
		assert.NotEmpty(t, r.Header.Get("User-Agent"))
		assert.Equal(t, "application/json", r.Header.Get("Accept"))

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "query": {"pages": [
    {"title":"File:CC BY.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/by.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:CC_BY.jpg","extmetadata":{
      "Artist":{"value":"<a href=\"/wiki/User:Ada\">Ada &amp; Team</a>"},
      "Credit":{"value":"Own work<br>Food Link"},
      "LicenseShortName":{"value":"CC BY 4.0"},
      "LicenseUrl":{"value":"https://creativecommons.org/licenses/by/4.0/"}
    }}]},
    {"title":"File:Public domain.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/pd.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Public_domain.jpg","extmetadata":{
      "Artist":{"value":"Unknown"},"LicenseShortName":{"value":"Public domain"},"LicenseUrl":{"value":"https://creativecommons.org/publicdomain/mark/1.0/"}
    }}]},
    {"title":"File:CC0.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/cc0.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:CC0.jpg","extmetadata":{
      "Credit":{"value":"Donated image"},"LicenseShortName":{"value":"CC0 1.0"},"LicenseUrl":{"value":"//creativecommons.org/publicdomain/zero/1.0/"}
    }}]},
    {"title":"File:CC BY-SA.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/by-sa.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:CC_BY-SA.jpg","extmetadata":{
      "Artist":{"value":"Lin"},"LicenseShortName":{"value":"CC BY-SA 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by-sa/4.0/"}
    }}]},
    {"title":"File:NC.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/nc.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:NC.jpg","extmetadata":{
      "LicenseShortName":{"value":"CC BY-NC-SA 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by-nc-sa/4.0/"}
    }}]},
    {"title":"File:ND.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/nd.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:ND.jpg","extmetadata":{
      "LicenseShortName":{"value":"CC BY-ND 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by-nd/4.0/"}
    }}]},
    {"title":"File:GFDL.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/gfdl.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:GFDL.jpg","extmetadata":{
      "LicenseShortName":{"value":"GFDL 1.2"},"LicenseUrl":{"value":"https://www.gnu.org/licenses/old-licenses/fdl-1.2.html"}
    }}]},
    {"title":"File:Missing license.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/missing.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Missing_license.jpg","extmetadata":{}}]},
    {"title":"File:No imageinfo.jpg"}
  ]}
}`))
	}))
	defer server.Close()

	client := newCommonsSearchClient(server.Client())
	client.endpoint = server.URL
	candidates, err := client.Search(context.Background(), " black soybeans ", 10)
	require.NoError(t, err)
	require.True(t, requestSeen)
	require.Len(t, candidates, 4)

	assert.Equal(t, commonsImageCandidate{
		ImageURL:    "https://upload.wikimedia.org/by.jpg",
		PageURL:     "https://commons.wikimedia.org/wiki/File:CC_BY.jpg",
		Author:      "Ada & Team",
		Credit:      "Own work Food Link",
		LicenseName: "CC BY 4.0",
		LicenseURL:  "https://creativecommons.org/licenses/by/4.0/",
	}, candidates[0])
	assert.Equal(t, "Public domain", candidates[1].LicenseName)
	assert.Equal(t, "CC0 1.0", candidates[2].LicenseName)
	assert.Equal(t, "https://creativecommons.org/publicdomain/zero/1.0/", candidates[2].LicenseURL)
	assert.Equal(t, "CC BY-SA 4.0", candidates[3].LicenseName)
}

func TestCommonsSearchFallsBackToFilePageAndDeduplicates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"query":{"pages":[
  {"title":"File:Yellow soybeans 1.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/same.jpg","extmetadata":{"LicenseShortName":{"value":"CC BY 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by/4.0/"}}}]},
  {"title":"File:Duplicate.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/same.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Duplicate.jpg","extmetadata":{"LicenseShortName":{"value":"CC BY 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by/4.0/"}}}]}
]}}`))
	}))
	defer server.Close()

	client := newCommonsSearchClient(server.Client())
	client.endpoint = server.URL
	candidates, err := client.Search(context.Background(), "soybeans", 5)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "https://commons.wikimedia.org/wiki/File:Yellow_soybeans_1.jpg", candidates[0].PageURL)
}

func TestParseCommonsLicenseRejectsIncompleteRestrictedAndMismatchedMetadata(t *testing.T) {
	metadata := func(name, licenseURL string) commonsAPIExtMetadata {
		return commonsAPIExtMetadata{
			"LicenseShortName": {Value: name},
			"LicenseUrl":       {Value: licenseURL},
		}
	}

	tests := []struct {
		name       string
		metadata   commonsAPIExtMetadata
		acceptable bool
	}{
		{name: "cc by", metadata: metadata("CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/"), acceptable: true},
		{name: "cc by-sa", metadata: metadata("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"), acceptable: true},
		{name: "cc zero", metadata: metadata("Creative Commons CC0 1.0 Universal", "https://creativecommons.org/publicdomain/zero/1.0/"), acceptable: true},
		{name: "missing name", metadata: metadata("", "https://creativecommons.org/licenses/by/4.0/")},
		{name: "missing url", metadata: metadata("CC BY 4.0", "")},
		{name: "nc", metadata: metadata("CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0/")},
		{name: "nd", metadata: metadata("CC BY-ND 4.0", "https://creativecommons.org/licenses/by-nd/4.0/")},
		{name: "gfdl", metadata: metadata("GFDL 1.2", "https://www.gnu.org/licenses/old-licenses/fdl-1.2.html")},
		{name: "name url mismatch", metadata: metadata("CC BY 4.0", "https://creativecommons.org/licenses/by-sa/4.0/")},
		{name: "invalid url", metadata: metadata("CC BY 4.0", "javascript:alert(1)")},
		{name: "restriction metadata", metadata: commonsAPIExtMetadata{
			"LicenseShortName": {Value: "CC BY 4.0"},
			"LicenseUrl":       {Value: "https://creativecommons.org/licenses/by/4.0/"},
			"Restrictions":     {Value: "No derivatives"},
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, ok := parseCommonsLicense(test.metadata)
			assert.Equal(t, test.acceptable, ok)
		})
	}
}

func TestCommonsSearchReportsAPIAndValidationErrors(t *testing.T) {
	client := newCommonsSearchClient(http.DefaultClient)
	_, err := client.Search(context.Background(), " ", 1)
	assert.ErrorContains(t, err, "query is empty")
	_, err = client.Search(context.Background(), "soybeans", 0)
	assert.ErrorContains(t, err, "limit must be positive")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":{"code":"badrequest","info":"bad request from test"}}`))
	}))
	defer server.Close()
	client = newCommonsSearchClient(server.Client())
	client.endpoint = server.URL
	_, err = client.Search(context.Background(), "soybeans", 2)
	assert.ErrorContains(t, err, "commons api error badrequest")
}
