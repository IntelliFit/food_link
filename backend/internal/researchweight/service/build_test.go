package service

import (
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/researchweight/domain"

	"github.com/stretchr/testify/require"
)

func keyOf(raw string) string {
	if strings.HasPrefix(raw, "https://cdn.test/") {
		return strings.TrimPrefix(raw, "https://cdn.test/")
	}
	return ""
}

func photo(role string, name string) PhotoInput {
	return PhotoInput{Role: role, URL: "https://cdn.test/research-weight/u1/" + name, CapturedAt: "2026-10-28T04:00:00Z", Source: "camera"}
}

func itemPhoto(index int, name string) PhotoInput {
	p := photo(domain.RoleItemScale, name)
	p.ItemIndex = &index
	return p
}

func floatPtr(v float64) *float64 { return &v }

func wholeInput() SubmitInput {
	return SubmitInput{
		ClientKey: "sample-key-0001", Scene: "canteen", WeighingMode: domain.ModeWhole, DishName: "红烧牛肉面",
		VenueName: "清华 桃李园", ContainerType: "bowl", TareMode: domain.TareMeasured, TareGrams: 312.4,
		GrossReadingGrams: floatPtr(905.25), ScalePrecisionGrams: 1, ConsentVersion: domain.ConsentVersion,
		Device: map[string]any{"brand": "iPhone", "model": "iPhone 15", "secret": "x"},
		Photos: []PhotoInput{photo(domain.RoleTareScale, "t.jpg"), photo(domain.RoleGrossScale, "g.jpg"), photo(domain.RoleEvalTop, "top.jpg"), photo(domain.RoleEvalAngle, "angle.jpg")},
	}
}

func itemizedInput() SubmitInput {
	input := wholeInput()
	input.WeighingMode = domain.ModeItemized
	input.GrossReadingGrams = nil
	input.Items = []ItemInput{
		{Name: "面条", CumulativeReadingGrams: 562.4},
		{Name: "牛肉", CumulativeReadingGrams: 640.0, CookingMethod: "红烧"},
		{Name: "汤", CumulativeReadingGrams: 905.3, ContainsSoup: true},
	}
	input.Photos = []PhotoInput{
		photo(domain.RoleTareScale, "t.jpg"), itemPhoto(0, "i0.jpg"), itemPhoto(1, "i1.jpg"), itemPhoto(2, "i2.jpg"),
		photo(domain.RoleEvalTop, "top.jpg"), photo(domain.RoleEvalAngle, "angle.jpg"),
	}
	return input
}

func TestBuildSampleWholeComputesNetFromReadings(t *testing.T) {
	sample, err := BuildSample("u1", wholeInput(), keyOf, time.Now())
	require.NoError(t, err)
	require.Equal(t, 312.4, sample.TareGrams)
	require.Equal(t, 905.3, *sample.GrossReadingGrams)
	require.Equal(t, 592.9, sample.TotalNetGrams)
	require.Equal(t, "research-weight/u1/top.jpg", photoKey(sample.Photos, domain.RoleEvalTop))
	require.Equal(t, map[string]any{"brand": "iPhone", "model": "iPhone 15"}, sample.Device)
	require.Equal(t, domain.StatusPending, sample.Status)
}

func TestBuildSampleItemizedComputesIncrements(t *testing.T) {
	sample, err := BuildSample("u1", itemizedInput(), keyOf, time.Now())
	require.NoError(t, err)
	require.Len(t, sample.Items, 3)
	require.Equal(t, 250.0, sample.Items[0].Grams)
	require.Equal(t, 77.6, sample.Items[1].Grams)
	require.Equal(t, 265.3, sample.Items[2].Grams)
	require.Equal(t, 592.9, sample.TotalNetGrams)
}

func TestBuildSampleItemizedWithZeroedScaleStartsAtZero(t *testing.T) {
	input := itemizedInput()
	input.TareMode = domain.TareZeroed
	input.TareGrams = 300
	sample, err := BuildSample("u1", input, keyOf, time.Now())
	require.NoError(t, err)
	require.Equal(t, 0.0, sample.TareGrams)
	require.Equal(t, 562.4, sample.Items[0].Grams)
	require.Equal(t, 905.3, sample.TotalNetGrams)
}

func TestBuildSampleRejectsInvalidSubmissions(t *testing.T) {
	cases := map[string]func(*SubmitInput){
		"stale consent":           func(in *SubmitInput) { in.ConsentVersion = "old" },
		"gross below tare":        func(in *SubmitInput) { in.GrossReadingGrams = floatPtr(300) },
		"missing gross photo":     func(in *SubmitInput) { in.Photos = in.Photos[:1] },
		"foreign photo":           func(in *SubmitInput) { in.Photos[2].URL = "https://evil.test/top.jpg" },
		"duplicate photo":         func(in *SubmitInput) { in.Photos[3].URL = in.Photos[2].URL },
		"reference without photo": func(in *SubmitInput) { in.ReferenceObject = "chopsticks" },
		"reference photo no type": func(in *SubmitInput) { in.Photos = append(in.Photos, photo(domain.RoleEvalTopRef, "ref.jpg")) },
		"items in whole mode":     func(in *SubmitInput) { in.Items = []ItemInput{{Name: "面", CumulativeReadingGrams: 400}} },
		"missing dish name":       func(in *SubmitInput) { in.DishName = " " },
		"bad client key":          func(in *SubmitInput) { in.ClientKey = "x" },
		"unknown scene":           func(in *SubmitInput) { in.Scene = "space" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			input := wholeInput()
			mutate(&input)
			_, err := BuildSample("u1", input, keyOf, time.Now())
			require.Error(t, err)
		})
	}
}

func TestBuildSampleItemizedRejectsNonIncreasingAndMissingItemPhoto(t *testing.T) {
	input := itemizedInput()
	input.Items[1].CumulativeReadingGrams = 500
	_, err := BuildSample("u1", input, keyOf, time.Now())
	require.ErrorContains(t, err, "第2项")

	input = itemizedInput()
	input.Photos = append(input.Photos[:2], input.Photos[3:]...)
	_, err = BuildSample("u1", input, keyOf, time.Now())
	require.ErrorContains(t, err, "第2项")
}

func TestBuildSampleAcceptsMatchingReferencePhotos(t *testing.T) {
	input := wholeInput()
	input.ReferenceObject = "chopsticks"
	input.Photos = append(input.Photos, photo(domain.RoleEvalTopRef, "ref-top.jpg"), photo(domain.RoleEvalAngleRef, "ref-angle.jpg"))
	input.VideoURL = "https://cdn.test/research-weight/u1/v.mp4"
	sample, err := BuildSample("u1", input, keyOf, time.Now())
	require.NoError(t, err)
	require.Len(t, sample.Photos, 6)
	require.Equal(t, "research-weight/u1/v.mp4", sample.VideoObjectKey)
}
