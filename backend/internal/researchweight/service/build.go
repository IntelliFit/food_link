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

// ItemInput is one itemized component, or one container in multi mode. Multi
// containers carry their own gross reading and tare; client gram values are
// never trusted.
type ItemInput struct {
	Name                   string   `json:"name"`
	CumulativeReadingGrams float64  `json:"cumulative_reading_grams"`
	ContainsBone           bool     `json:"contains_bone"`
	ContainsSoup           bool     `json:"contains_soup"`
	CookingMethod          string   `json:"cooking_method"`
	GrossReadingGrams      *float64 `json:"gross_reading_grams"`
	TareSource             string   `json:"tare_source"`
	TareGrams              *float64 `json:"tare_grams"`
	ContainerID            string   `json:"container_id"`
	ContainerType          string   `json:"container_type"`
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
	ContainerID         string         `json:"container_id"`
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

// Library holds the submitter's active saved containers by ID.
type Library map[string]domain.Container

// BuildSample validates a submission and computes every gram value from the
// scale readings; client-side gram values are never trusted.
func BuildSample(userID string, input SubmitInput, resolve KeyResolver, library Library, now time.Time) (*domain.Sample, error) {
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
	if mode != domain.ModeWhole && mode != domain.ModeItemized && mode != domain.ModeMulti {
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
	sample := &domain.Sample{
		UserID: userID, ClientKey: strings.TrimSpace(input.ClientKey), Scene: scene, WeighingMode: mode,
		DishName: dish, VenueName: venue, City: city, ContainerType: container, TareMode: tareMode,
		ScalePrecisionGrams: precision, ReferenceObject: reference, Notes: notes,
		Device: cleanDevice(input.Device), ConsentVersion: domain.ConsentVersion, ConsentedAt: now,
		Status: domain.StatusPending, Items: []domain.Item{},
	}
	var sampleTareContainer *domain.Container
	if mode == domain.ModeMulti {
		if tareMode != domain.TarePerContainer {
			return nil, badRequest("按盒称时每盒单独记皮重")
		}
		if err := applyMulti(sample, input.Items, library); err != nil {
			return nil, err
		}
	} else {
		tare, saved, err := readTare(tareMode, input.TareGrams, input.ContainerID, library)
		if err != nil {
			return nil, err
		}
		sample.TareGrams, sampleTareContainer = tare, saved
		if mode == domain.ModeWhole {
			err = applyWhole(sample, input)
		} else {
			err = applyItemized(sample, input.Items)
		}
		if err != nil {
			return nil, err
		}
	}
	photos, err := buildPhotos(input.Photos, sample, reference, resolve)
	if err != nil {
		return nil, err
	}
	saved := libraryPhotos(sample, sampleTareContainer, library)
	if err := rejectSavedPhotoReuse(photos, saved); err != nil {
		return nil, err
	}
	sample.Photos = append(photos, saved...)
	if raw := strings.TrimSpace(input.VideoURL); raw != "" {
		key := resolve(raw)
		if key == "" {
			return nil, badRequest("视频必须来自食探上传")
		}
		sample.VideoObjectKey = key
	}
	return sample, nil
}

func readTare(mode string, grams float64, containerID string, library Library) (float64, *domain.Container, error) {
	switch mode {
	case domain.TareMeasured, domain.TareAfterMeal:
		if grams <= 0 || grams > domain.MaxReadingGrams {
			return 0, nil, badRequest("请填写空容器的读数")
		}
		return round1(grams), nil, nil
	case domain.TareZeroed:
		return 0, nil, nil
	case domain.TareLibrary:
		saved, ok := library[strings.TrimSpace(containerID)]
		if !ok {
			return 0, nil, badRequest("常用容器不存在或已停用，请重新选择")
		}
		return saved.Grams, &saved, nil
	default:
		return 0, nil, badRequest("请选择去皮方式")
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

// applyMulti records each container (a takeout box, a bowl) with its own
// gross reading and tare. The meal total is the sum of the containers.
func applyMulti(sample *domain.Sample, inputs []ItemInput, library Library) error {
	if len(inputs) == 0 || len(inputs) > domain.MaxContainers {
		return badRequest(fmt.Sprintf("按盒称需要1到%d个容器", domain.MaxContainers))
	}
	items := make([]domain.Item, 0, len(inputs))
	total := 0.0
	for index, input := range inputs {
		item, err := buildContainer(index, input, library)
		if err != nil {
			return err
		}
		total += item.Grams
		items = append(items, item)
	}
	total = round1(total)
	if total > domain.MaxTotalGrams {
		return badRequest("一顿饭不能超过10000g")
	}
	sample.Items = items
	sample.TotalNetGrams = total
	return nil
}

func buildContainer(index int, input ItemInput, library Library) (domain.Item, error) {
	label := index + 1
	name := strings.TrimSpace(input.Name)
	if name == "" || runeLen(name) > 30 {
		return domain.Item{}, badRequest(fmt.Sprintf("第%d盒请填写不超过30字的名称", label))
	}
	if input.GrossReadingGrams == nil || *input.GrossReadingGrams <= 0 || *input.GrossReadingGrams > domain.MaxReadingGrams {
		return domain.Item{}, badRequest(fmt.Sprintf("请填写第%d盒连盒的读数", label))
	}
	gross := round1(*input.GrossReadingGrams)
	source := strings.TrimSpace(input.TareSource)
	containerType := strings.TrimSpace(input.ContainerType)
	containerID := ""
	var tare float64
	switch source {
	case domain.TareMeasured, domain.TareAfterMeal:
		if input.TareGrams == nil || *input.TareGrams <= 0 {
			return domain.Item{}, badRequest(fmt.Sprintf("请填写第%d盒空盒的读数", label))
		}
		tare = round1(*input.TareGrams)
	case domain.TareZeroed:
		tare = 0
	case domain.TareLibrary:
		saved, ok := library[strings.TrimSpace(input.ContainerID)]
		if !ok {
			return domain.Item{}, badRequest(fmt.Sprintf("第%d盒选的常用容器不存在或已停用", label))
		}
		tare, containerID, containerType = saved.Grams, saved.ID, saved.ContainerType
	default:
		return domain.Item{}, badRequest(fmt.Sprintf("请选择第%d盒的皮重来源", label))
	}
	if containerType != "" && !slices.Contains(domain.ContainerTypes, containerType) {
		containerType = ""
	}
	if gross <= tare {
		return domain.Item{}, badRequest(fmt.Sprintf("第%d盒的连盒读数必须大于空盒重量", label))
	}
	net := round1(gross - tare)
	if net > domain.MaxNetGrams {
		return domain.Item{}, badRequest("单盒食物不能超过5000g")
	}
	grossValue, tareValue := gross, tare
	return domain.Item{
		Name: name, Grams: net, GrossReadingGrams: &grossValue, TareGrams: &tareValue, TareSource: source,
		ContainerID: containerID, ContainerType: containerType,
		ContainsBone: input.ContainsBone, ContainsSoup: input.ContainsSoup,
	}, nil
}

// buildPhotos checks that every reading has its scale photo and that at least
// one evaluation photo is present. Saved containers need no empty photo: their
// photo from when they were saved is attached by libraryPhotos.
func buildPhotos(inputs []PhotoInput, sample *domain.Sample, reference string, resolve KeyResolver) ([]domain.Photo, error) {
	if len(inputs) > 40 {
		return nil, badRequest("照片过多")
	}
	mode, itemCount := sample.WeighingMode, len(sample.Items)
	counts := map[string]int{}
	itemSeen := map[string][]bool{
		domain.RoleItemScale: make([]bool, itemCount), domain.RoleContainerGross: make([]bool, itemCount), domain.RoleContainerTare: make([]bool, itemCount),
	}
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
		if seen, indexed := itemSeen[role]; indexed {
			if !roleFitsMode(role, mode) || input.ItemIndex == nil || *input.ItemIndex < 0 || *input.ItemIndex >= itemCount || seen[*input.ItemIndex] {
				return nil, badRequest("读数照片与分项或盒子不对应")
			}
			index := *input.ItemIndex
			if role == domain.RoleContainerTare && sample.Items[index].TareSource == domain.TareLibrary {
				return nil, badRequest(fmt.Sprintf("第%d盒用了常用容器，不用再拍空盒", index+1))
			}
			seen[index] = true
			photo.ItemIndex = &index
		}
		counts[role]++
		photos = append(photos, photo)
	}
	if counts[domain.RoleEvalTop] > 1 || counts[domain.RoleEvalAngle] > 1 {
		return nil, badRequest("每个角度的评测照片只需一张")
	}
	if counts[domain.RoleEvalTop]+counts[domain.RoleEvalAngle] == 0 {
		return nil, badRequest("请至少拍一张评测照片")
	}
	if err := checkReadingPhotos(sample, counts, itemSeen); err != nil {
		return nil, err
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

func checkReadingPhotos(sample *domain.Sample, counts map[string]int, itemSeen map[string][]bool) error {
	if sample.WeighingMode == domain.ModeMulti {
		if counts[domain.RoleTareScale] > 0 || counts[domain.RoleGrossScale] > 0 {
			return badRequest("按盒称不需要整份读数照片")
		}
		for index, item := range sample.Items {
			if !itemSeen[domain.RoleContainerGross][index] {
				return badRequest(fmt.Sprintf("请拍第%d盒连盒的读数", index+1))
			}
			if item.TareSource != domain.TareLibrary && !itemSeen[domain.RoleContainerTare][index] {
				return badRequest(fmt.Sprintf("请拍第%d盒空盒（或归零）的读数", index+1))
			}
		}
		return nil
	}
	needTare := sample.TareMode != domain.TareLibrary
	if needTare && counts[domain.RoleTareScale] != 1 {
		return badRequest(missingPhotoMessage(domain.RoleTareScale))
	}
	if !needTare && counts[domain.RoleTareScale] > 0 {
		return badRequest("用了常用容器，不用再拍空容器")
	}
	if sample.WeighingMode == domain.ModeWhole {
		if counts[domain.RoleGrossScale] != 1 {
			return badRequest(missingPhotoMessage(domain.RoleGrossScale))
		}
		return nil
	}
	if counts[domain.RoleGrossScale] > 0 {
		return badRequest("分项称量不需要整份读数照片")
	}
	for index, seen := range itemSeen[domain.RoleItemScale] {
		if !seen {
			return badRequest(fmt.Sprintf("请拍第%d项的秤上读数", index+1))
		}
	}
	return nil
}

// libraryPhotos attaches the photo taken when each used container was saved,
// so every tare in the sample still has scale evidence.
func libraryPhotos(sample *domain.Sample, sampleTare *domain.Container, library Library) []domain.Photo {
	photos := []domain.Photo{}
	if sampleTare != nil {
		photos = append(photos, domain.Photo{Role: domain.RoleTareScale, ObjectKey: sampleTare.PhotoObjectKey, Source: domain.PhotoSourceLibrary})
	}
	for index, item := range sample.Items {
		if item.TareSource != domain.TareLibrary {
			continue
		}
		saved := library[item.ContainerID]
		itemIndex := index
		photos = append(photos, domain.Photo{Role: domain.RoleContainerTare, ObjectKey: saved.PhotoObjectKey, ItemIndex: &itemIndex, Source: domain.PhotoSourceLibrary})
	}
	return photos
}

// rejectSavedPhotoReuse stops a client from submitting a saved container's
// photo as some other reading or as the meal photo.
func rejectSavedPhotoReuse(client, saved []domain.Photo) error {
	keys := make(map[string]struct{}, len(saved))
	for _, photo := range saved {
		keys[photo.ObjectKey] = struct{}{}
	}
	for _, photo := range client {
		if _, reused := keys[photo.ObjectKey]; reused {
			return badRequest("常用容器的照片不能再当作别的读数或评测照片")
		}
	}
	return nil
}

func roleFitsMode(role, mode string) bool {
	if role == domain.RoleItemScale {
		return mode == domain.ModeItemized
	}
	return mode == domain.ModeMulti
}

func validRole(role string) bool {
	switch role {
	case domain.RoleTareScale, domain.RoleGrossScale, domain.RoleItemScale, domain.RoleContainerGross, domain.RoleContainerTare,
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
	}
	return "照片不完整"
}

// isTareRole reports the photos that may legitimately repeat across samples:
// the same empty bowl or saved container is weighed once for many meals.
func isTareRole(role string) bool {
	return role == domain.RoleTareScale || role == domain.RoleContainerTare
}

// sampleFlags marks samples a reviewer should look at: an empty container
// "weighed after eating" whose photo predates the evaluation photo.
func sampleFlags(sample *domain.Sample) []string {
	var latestEval time.Time
	for _, photo := range sample.Photos {
		if photo.Role != domain.RoleEvalTop && photo.Role != domain.RoleEvalAngle {
			continue
		}
		if at, err := time.Parse(time.RFC3339, photo.CapturedAt); err == nil && at.After(latestEval) {
			latestEval = at
		}
	}
	if latestEval.IsZero() {
		return nil
	}
	for _, photo := range sample.Photos {
		if photo.Source == domain.PhotoSourceLibrary || !afterMealTarePhoto(sample, photo) {
			continue
		}
		if at, err := time.Parse(time.RFC3339, photo.CapturedAt); err == nil && at.Before(latestEval) {
			return []string{domain.FlagAfterMealTareEarly}
		}
	}
	return nil
}

func afterMealTarePhoto(sample *domain.Sample, photo domain.Photo) bool {
	if photo.Role == domain.RoleTareScale {
		return sample.TareMode == domain.TareAfterMeal
	}
	if photo.Role != domain.RoleContainerTare || photo.ItemIndex == nil || *photo.ItemIndex >= len(sample.Items) {
		return false
	}
	return sample.Items[*photo.ItemIndex].TareSource == domain.TareAfterMeal
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

// cleanSource keeps only what a client may claim; "library" is set by the
// server for saved-container photos.
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
