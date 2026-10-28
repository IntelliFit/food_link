package service

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/researchweight/domain"
)

var clientKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

type ItemInput struct {
	Name                   string  `json:"name"`
	CumulativeReadingGrams float64 `json:"cumulative_reading_grams"`
	ContainsBone           bool    `json:"contains_bone"`
	ContainsSoup           bool    `json:"contains_soup"`
	CookingMethod          string  `json:"cooking_method"`
}

type PhotoInput struct {
	Role       string `json:"role"`
	URL        string `json:"url"`
	ItemIndex  *int   `json:"item_index"`
	CapturedAt string `json:"captured_at"`
	Source     string `json:"source"`
}

type SubmitInput struct {
	ClientKey           string         `json:"client_key"`
	Scene               string         `json:"scene"`
	WeighingMode        string         `json:"weighing_mode"`
	DishName            string         `json:"dish_name"`
	VenueName           string         `json:"venue_name"`
	City                string         `json:"city"`
	ContainerType       string         `json:"container_type"`
	TareMode            string         `json:"tare_mode"`
	TareGrams           float64        `json:"tare_grams"`
	GrossReadingGrams   *float64       `json:"gross_reading_grams"`
	ScalePrecisionGrams float64        `json:"scale_precision_grams"`
	Items               []ItemInput    `json:"items"`
	Photos              []PhotoInput   `json:"photos"`
	ReferenceObject     string         `json:"reference_object"`
	VideoURL            string         `json:"video_url"`
	Device              map[string]any `json:"device"`
	Notes               string         `json:"notes"`
	ConsentVersion      string         `json:"consent_version"`
}

// KeyResolver turns an uploaded image or video URL into a storage object key,
// returning "" when the value does not point at FoodLink storage.
type KeyResolver func(raw string) string

// BuildSample validates a submission and computes every gram value from the
// scale readings; client-side gram values are never trusted.
func BuildSample(userID string, input SubmitInput, resolve KeyResolver, now time.Time) (*domain.Sample, error) {
	if !clientKeyPattern.MatchString(strings.TrimSpace(input.ClientKey)) {
		return nil, badRequest("提交标识无效，请重新进入页面")
	}
	if strings.TrimSpace(input.ConsentVersion) != domain.ConsentVersion {
		return nil, badRequest("请先阅读并同意最新的研究数据授权")
	}
	scene, mode := strings.TrimSpace(input.Scene), strings.TrimSpace(input.WeighingMode)
	container, tareMode := strings.TrimSpace(input.ContainerType), strings.TrimSpace(input.TareMode)
	if !slices.Contains(domain.Scenes, scene) {
		return nil, badRequest("请选择用餐场景")
	}
	if mode != domain.ModeWhole && mode != domain.ModeItemized {
		return nil, badRequest("请选择称量方式")
	}
	if !slices.Contains(domain.ContainerTypes, container) {
		return nil, badRequest("请选择容器类型")
	}
	reference := strings.TrimSpace(input.ReferenceObject)
	if reference == "" {
		reference = "none"
	}
	if !slices.Contains(domain.ReferenceObjects, reference) {
		return nil, badRequest("参照物类型不正确")
	}
	precision := input.ScalePrecisionGrams
	if precision <= 0 || precision > 5 {
		return nil, badRequest("请选择秤的精度")
	}
	dish, venue, city, notes := strings.TrimSpace(input.DishName), strings.TrimSpace(input.VenueName), strings.TrimSpace(input.City), strings.TrimSpace(input.Notes)
	if dish == "" || runeLen(dish) > 60 {
		return nil, badRequest("请填写不超过60字的菜名")
	}
	if runeLen(venue) > 60 || runeLen(city) > 30 || runeLen(notes) > 300 {
		return nil, badRequest("地点、城市或备注过长")
	}
	tare, err := readTare(tareMode, input.TareGrams)
	if err != nil {
		return nil, err
	}
	sample := &domain.Sample{
		UserID: userID, ClientKey: strings.TrimSpace(input.ClientKey), Scene: scene, WeighingMode: mode,
		DishName: dish, VenueName: venue, City: city, ContainerType: container, TareMode: tareMode,
		TareGrams: tare, ScalePrecisionGrams: precision, ReferenceObject: reference, Notes: notes,
		Device: cleanDevice(input.Device), ConsentVersion: domain.ConsentVersion, ConsentedAt: now,
		Status: domain.StatusPending, Items: []domain.Item{},
	}
	if mode == domain.ModeWhole {
		if err := applyWhole(sample, input); err != nil {
			return nil, err
		}
	} else if err := applyItemized(sample, input.Items); err != nil {
		return nil, err
	}
	photos, err := buildPhotos(input.Photos, mode, len(sample.Items), reference, resolve)
	if err != nil {
		return nil, err
	}
	sample.Photos = photos
	if raw := strings.TrimSpace(input.VideoURL); raw != "" {
		key := resolve(raw)
		if key == "" {
			return nil, badRequest("视频必须来自食探上传")
		}
		sample.VideoObjectKey = key
	}
	return sample, nil
}

func readTare(mode string, grams float64) (float64, error) {
	switch mode {
	case domain.TareMeasured:
		if grams <= 0 || grams > domain.MaxReadingGrams {
			return 0, badRequest("请填写空容器的读数")
		}
		return round1(grams), nil
	case domain.TareZeroed:
		return 0, nil
	default:
		return 0, badRequest("请选择去皮方式")
	}
}

func applyWhole(sample *domain.Sample, input SubmitInput) error {
	if len(input.Items) > 0 {
		return badRequest("整份称量不需要分项读数")
	}
	if input.GrossReadingGrams == nil {
		return badRequest("请填写连容器的总读数")
	}
	gross := round1(*input.GrossReadingGrams)
	if gross <= sample.TareGrams || gross > domain.MaxReadingGrams {
		return badRequest("总读数必须大于空容器读数")
	}
	net := round1(gross - sample.TareGrams)
	if net > domain.MaxNetGrams {
		return badRequest("单份食物不能超过5000g")
	}
	sample.GrossReadingGrams = &gross
	sample.TotalNetGrams = net
	return nil
}

func applyItemized(sample *domain.Sample, inputs []ItemInput) error {
	if len(inputs) == 0 || len(inputs) > domain.MaxItems {
		return badRequest(fmt.Sprintf("分项称量需要1到%d项", domain.MaxItems))
	}
	previous := sample.TareGrams
	items := make([]domain.Item, 0, len(inputs))
	for index, input := range inputs {
		name := strings.TrimSpace(input.Name)
		if name == "" || runeLen(name) > 30 {
			return badRequest(fmt.Sprintf("第%d项请填写不超过30字的名称", index+1))
		}
		reading := round1(input.CumulativeReadingGrams)
		if reading <= previous || reading > domain.MaxReadingGrams {
			return badRequest(fmt.Sprintf("第%d项的秤上读数必须大于上一次读数", index+1))
		}
		items = append(items, domain.Item{
			Name: name, CumulativeReadingGrams: reading, Grams: round1(reading - previous),
			ContainsBone: input.ContainsBone, ContainsSoup: input.ContainsSoup,
			CookingMethod: truncateRunes(strings.TrimSpace(input.CookingMethod), 20),
		})
		previous = reading
	}
	net := round1(previous - sample.TareGrams)
	if net > domain.MaxNetGrams {
		return badRequest("单份食物不能超过5000g")
	}
	sample.Items = items
	sample.TotalNetGrams = net
	return nil
}

// buildPhotos checks that every reading has its scale photo and that both
// evaluation angles are present. Reference photos are optional but must match
// the declared reference object.
func buildPhotos(inputs []PhotoInput, mode string, itemCount int, reference string, resolve KeyResolver) ([]domain.Photo, error) {
	if len(inputs) > 24 {
		return nil, badRequest("照片过多")
	}
	counts := map[string]int{}
	itemSeen := make([]bool, itemCount)
	seenKeys := map[string]struct{}{}
	photos := make([]domain.Photo, 0, len(inputs))
	for _, input := range inputs {
		role := strings.TrimSpace(input.Role)
		if !validRole(role) {
			return nil, badRequest("照片类型不正确")
		}
		key := resolve(strings.TrimSpace(input.URL))
		if key == "" {
			return nil, badRequest("照片必须来自食探上传")
		}
		if _, dup := seenKeys[key]; dup {
			return nil, badRequest("同一张照片不能重复使用")
		}
		seenKeys[key] = struct{}{}
		photo := domain.Photo{Role: role, ObjectKey: key, CapturedAt: cleanTimestamp(input.CapturedAt), Source: cleanSource(input.Source)}
		if role == domain.RoleItemScale {
			if mode != domain.ModeItemized || input.ItemIndex == nil || *input.ItemIndex < 0 || *input.ItemIndex >= itemCount || itemSeen[*input.ItemIndex] {
				return nil, badRequest("分项读数照片与分项不对应")
			}
			itemSeen[*input.ItemIndex] = true
			index := *input.ItemIndex
			photo.ItemIndex = &index
		}
		counts[role]++
		photos = append(photos, photo)
	}
	for _, role := range []string{domain.RoleTareScale, domain.RoleEvalTop, domain.RoleEvalAngle} {
		if counts[role] != 1 {
			return nil, badRequest(missingPhotoMessage(role))
		}
	}
	if mode == domain.ModeWhole && counts[domain.RoleGrossScale] != 1 {
		return nil, badRequest(missingPhotoMessage(domain.RoleGrossScale))
	}
	if mode == domain.ModeItemized {
		if counts[domain.RoleGrossScale] > 0 {
			return nil, badRequest("分项称量不需要整份读数照片")
		}
		for index, seen := range itemSeen {
			if !seen {
				return nil, badRequest(fmt.Sprintf("请拍第%d项的秤上读数", index+1))
			}
		}
	}
	refCount := counts[domain.RoleEvalTopRef] + counts[domain.RoleEvalAngleRef]
	if counts[domain.RoleEvalTopRef] > 1 || counts[domain.RoleEvalAngleRef] > 1 {
		return nil, badRequest("参照物照片每个角度只需一张")
	}
	if refCount > 0 && reference == "none" {
		return nil, badRequest("请选择照片里的参照物")
	}
	if refCount == 0 && reference != "none" {
		return nil, badRequest("选择了参照物，请补拍参照物照片")
	}
	return photos, nil
}

func validRole(role string) bool {
	switch role {
	case domain.RoleTareScale, domain.RoleGrossScale, domain.RoleItemScale,
		domain.RoleEvalTop, domain.RoleEvalAngle, domain.RoleEvalTopRef, domain.RoleEvalAngleRef:
		return true
	}
	return false
}

func missingPhotoMessage(role string) string {
	switch role {
	case domain.RoleTareScale:
		return "请拍空容器（或归零）时的秤上读数"
	case domain.RoleGrossScale:
		return "请拍连容器的秤上总读数"
	case domain.RoleEvalTop:
		return "请拍一张俯拍照片"
	case domain.RoleEvalAngle:
		return "请拍一张约45°的照片"
	}
	return "照片不完整"
}

func cleanDevice(raw map[string]any) map[string]any {
	device := map[string]any{}
	for _, key := range []string{"brand", "model", "system", "platform"} {
		if value, ok := raw[key].(string); ok && strings.TrimSpace(value) != "" {
			device[key] = truncateRunes(strings.TrimSpace(value), 60)
		}
	}
	return device
}

func cleanTimestamp(raw string) string {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

func cleanSource(raw string) string {
	if source := strings.TrimSpace(raw); source == "camera" || source == "album" {
		return source
	}
	return ""
}

func round1(value float64) float64 { return math.Round(value*10) / 10 }

func runeLen(value string) int { return len([]rune(value)) }

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}
