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
	sample, err := BuildSample("u1", wholeInput(), keyOf, nil, time.Now())
	require.NoError(t, err)
	require.Equal(t, 312.4, sample.TareGrams)
	require.Equal(t, 905.3, *sample.GrossReadingGrams)
	require.Equal(t, 592.9, sample.TotalNetGrams)
	require.Equal(t, "research-weight/u1/top.jpg", photoKey(sample.Photos, domain.RoleEvalTop))
	require.Equal(t, map[string]any{"brand": "iPhone", "model": "iPhone 15"}, sample.Device)
	require.Equal(t, domain.StatusPending, sample.Status)
}

func TestBuildSampleItemizedComputesIncrements(t *testing.T) {
	sample, err := BuildSample("u1", itemizedInput(), keyOf, nil, time.Now())
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
	sample, err := BuildSample("u1", input, keyOf, nil, time.Now())
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
			_, err := BuildSample("u1", input, keyOf, nil, time.Now())
			require.Error(t, err)
		})
	}
}

func TestBuildSampleItemizedRejectsNonIncreasingAndMissingItemPhoto(t *testing.T) {
	input := itemizedInput()
	input.Items[1].CumulativeReadingGrams = 500
	_, err := BuildSample("u1", input, keyOf, nil, time.Now())
	require.ErrorContains(t, err, "第2项")

	input = itemizedInput()
	input.Photos = append(input.Photos[:2], input.Photos[3:]...)
	_, err = BuildSample("u1", input, keyOf, nil, time.Now())
	require.ErrorContains(t, err, "第2项")
}

func TestBuildSampleAcceptsMatchingReferencePhotos(t *testing.T) {
	input := wholeInput()
	input.ReferenceObject = "chopsticks"
	input.Photos = append(input.Photos, photo(domain.RoleEvalTopRef, "ref-top.jpg"), photo(domain.RoleEvalAngleRef, "ref-angle.jpg"))
	input.VideoURL = "https://cdn.test/research-weight/u1/v.mp4"
	sample, err := BuildSample("u1", input, keyOf, nil, time.Now())
	require.NoError(t, err)
	require.Len(t, sample.Photos, 6)
	require.Equal(t, "research-weight/u1/v.mp4", sample.VideoObjectKey)
}

func containerPhoto(role string, index int, name, at string) PhotoInput {
	p := photo(role, name)
	p.ItemIndex = &index
	p.CapturedAt = at
	return p
}

func savedLibrary() Library {
	return Library{"c1": {ID: "c1", Name: "750ml 圆盒", ContainerType: "box", Grams: 28.5, PhotoObjectKey: "research-weight/u1/photos/lib.jpg"}}
}

// A three-box takeout: rice weighed empty after eating, a saved box, and soup
// in a bowl that was put on the scale and zeroed before pouring.
func multiInput() SubmitInput {
	return SubmitInput{
		ClientKey: "sample-key-multi", Scene: "takeout", WeighingMode: domain.ModeMulti, DishName: "宫保鸡丁套餐",
		ContainerType: "box", TareMode: domain.TarePerContainer, ScalePrecisionGrams: 1, ConsentVersion: domain.ConsentVersion,
		Items: []ItemInput{
			{Name: "米饭", GrossReadingGrams: floatPtr(265), TareSource: domain.TareAfterMeal, TareGrams: floatPtr(18)},
			{Name: "宫保鸡丁", GrossReadingGrams: floatPtr(412.3), TareSource: domain.TareLibrary, ContainerID: "c1"},
			{Name: "紫菜汤", GrossReadingGrams: floatPtr(330), TareSource: domain.TareZeroed, ContainsSoup: true},
		},
		Photos: []PhotoInput{
			photo(domain.RoleEvalTop, "meal.jpg"),
			containerPhoto(domain.RoleContainerGross, 0, "g0.jpg", "2026-10-28T04:01:00Z"),
			containerPhoto(domain.RoleContainerGross, 1, "g1.jpg", "2026-10-28T04:02:00Z"),
			containerPhoto(domain.RoleContainerGross, 2, "g2.jpg", "2026-10-28T04:03:00Z"),
			containerPhoto(domain.RoleContainerTare, 0, "t0.jpg", "2026-10-28T04:40:00Z"),
			containerPhoto(domain.RoleContainerTare, 2, "z2.jpg", "2026-10-28T03:59:00Z"),
		},
	}
}

func TestBuildSampleAcceptsASingleEvalPhoto(t *testing.T) {
	input := wholeInput()
	input.Photos = []PhotoInput{photo(domain.RoleTareScale, "t.jpg"), photo(domain.RoleGrossScale, "g.jpg"), photo(domain.RoleEvalAngle, "angle.jpg")}
	_, err := BuildSample("u1", input, keyOf, nil, time.Now())
	require.NoError(t, err)

	input.Photos = input.Photos[:2]
	_, err = BuildSample("u1", input, keyOf, nil, time.Now())
	require.ErrorContains(t, err, "至少拍一张评测照片")

	input.Photos = append(input.Photos, photo(domain.RoleEvalTop, "a.jpg"), photo(domain.RoleEvalTop, "b.jpg"))
	_, err = BuildSample("u1", input, keyOf, nil, time.Now())
	require.ErrorContains(t, err, "只需一张")
}

func TestBuildSampleMultiWeighsEachContainerWithItsOwnTare(t *testing.T) {
	sample, err := BuildSample("u1", multiInput(), keyOf, savedLibrary(), time.Now())
	require.NoError(t, err)
	require.Len(t, sample.Items, 3)
	require.Equal(t, []float64{247, 383.8, 330}, []float64{sample.Items[0].Grams, sample.Items[1].Grams, sample.Items[2].Grams})
	require.Equal(t, 960.8, sample.TotalNetGrams)
	require.Equal(t, 0.0, sample.TareGrams)
	require.Equal(t, domain.TareLibrary, sample.Items[1].TareSource)
	require.Equal(t, "c1", sample.Items[1].ContainerID)
	require.Equal(t, "box", sample.Items[1].ContainerType)
	require.Equal(t, 28.5, *sample.Items[1].TareGrams)

	last := sample.Photos[len(sample.Photos)-1]
	require.Equal(t, domain.RoleContainerTare, last.Role)
	require.Equal(t, 1, *last.ItemIndex)
	require.Equal(t, domain.PhotoSourceLibrary, last.Source)
	require.Equal(t, "research-weight/u1/photos/lib.jpg", last.ObjectKey)
	require.Empty(t, sampleFlags(sample), "the zeroed bowl may be photographed before the meal photo")
}

func TestBuildSampleMultiRejectsIncompleteContainers(t *testing.T) {
	cases := map[string]struct {
		mutate func(*SubmitInput)
		want   string
	}{
		"gross photo missing":       {func(in *SubmitInput) { in.Photos = append(in.Photos[:3], in.Photos[4:]...) }, "第3盒连盒"},
		"after-meal tare unweighed": {func(in *SubmitInput) { in.Items[0].TareGrams = nil }, "第1盒空盒的读数"},
		"after-meal tare no photo":  {func(in *SubmitInput) { in.Photos = in.Photos[:5] }, "第3盒空盒"},
		"saved box with a photo": {func(in *SubmitInput) {
			in.Photos = append(in.Photos, containerPhoto(domain.RoleContainerTare, 1, "x.jpg", ""))
		}, "常用容器"},
		"unknown saved box":         {func(in *SubmitInput) { in.Items[1].ContainerID = "c9" }, "不存在或已停用"},
		"box lighter than its tare": {func(in *SubmitInput) { in.Items[0].GrossReadingGrams = floatPtr(15) }, "必须大于空盒"},
		"no tare source":            {func(in *SubmitInput) { in.Items[2].TareSource = "" }, "皮重来源"},
		"multi with a sample tare":  {func(in *SubmitInput) { in.TareMode = domain.TareMeasured }, "每盒单独"},
		"itemized photo in multi":   {func(in *SubmitInput) { in.Photos = append(in.Photos, itemPhoto(0, "i.jpg")) }, "不对应"},
		"too many containers": {func(in *SubmitInput) {
			for len(in.Items) < 9 {
				in.Items = append(in.Items, in.Items[2])
			}
		}, "1到8"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			input := multiInput()
			tc.mutate(&input)
			_, err := BuildSample("u1", input, keyOf, savedLibrary(), time.Now())
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestBuildSampleItemizedCanUseASavedContainerOrWeighAfterEating(t *testing.T) {
	input := itemizedInput()
	input.TareMode = domain.TareLibrary
	input.ContainerID = "c1"
	input.Photos = input.Photos[1:]
	sample, err := BuildSample("u1", input, keyOf, savedLibrary(), time.Now())
	require.NoError(t, err)
	require.Equal(t, 28.5, sample.TareGrams)
	require.Equal(t, 533.9, sample.Items[0].Grams)
	tare := sample.Photos[len(sample.Photos)-1]
	require.Equal(t, domain.RoleTareScale, tare.Role)
	require.Equal(t, domain.PhotoSourceLibrary, tare.Source)

	input.Photos = append(input.Photos, photo(domain.RoleTareScale, "t.jpg"))
	_, err = BuildSample("u1", input, keyOf, savedLibrary(), time.Now())
	require.ErrorContains(t, err, "不用再拍空容器")

	afterMeal := itemizedInput()
	afterMeal.TareMode = domain.TareAfterMeal
	sample, err = BuildSample("u1", afterMeal, keyOf, nil, time.Now())
	require.NoError(t, err)
	require.Equal(t, 312.4, sample.TareGrams)
}

func TestSampleFlagsCatchAnEmptyBoxPhotographedBeforeTheMeal(t *testing.T) {
	input := multiInput()
	input.Photos[4].CapturedAt = "2026-10-28T03:30:00Z"
	sample, err := BuildSample("u1", input, keyOf, savedLibrary(), time.Now())
	require.NoError(t, err)
	require.Equal(t, []string{domain.FlagAfterMealTareEarly}, sampleFlags(sample))
}
