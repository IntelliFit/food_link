package service

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/school/domain"
	"food_link/backend/internal/school/repo"
)

type CampusDirectoryRepo interface {
	GetSchool(ctx context.Context, schoolID string) (*domain.School, error)
	GetCampus(ctx context.Context, campusID string) (*domain.SchoolCampus, error)
	GetCanteen(ctx context.Context, canteenID string) (*domain.SchoolCanteen, error)
	ListCampuses(ctx context.Context, input repo.ListCampusesInput) ([]domain.SchoolCampus, error)
	ListCanteens(ctx context.Context, input repo.ListCanteensInput) ([]domain.SchoolCanteen, error)
	ListWindows(ctx context.Context, input repo.ListWindowsInput) ([]domain.CanteenWindow, error)
	CreateApplication(ctx context.Context, input repo.CreateApplicationInput) (*domain.CampusCanteenApplication, error)
}

type CampusDirectoryService struct {
	repo CampusDirectoryRepo
}

func (s *CampusDirectoryService) GetCampus(ctx context.Context, campusID string) (*domain.SchoolCampus, error) {
	if strings.TrimSpace(campusID) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "地点分区 ID 不能为空", HTTPStatus: 400}
	}
	return s.repo.GetCampus(ctx, campusID)
}

func NewCampusDirectoryService(repo CampusDirectoryRepo) *CampusDirectoryService {
	return &CampusDirectoryService{repo: repo}
}

type ListCampusesInput struct {
	SchoolID string
}

type ListCanteensInput struct {
	SchoolID string
	CampusID string
	Query    string
	Limit    int
}

type ListWindowsInput struct {
	CanteenID string
	Floor     string
	Query     string
	Limit     int
}

type ListFloorsInput struct {
	CanteenID string
}

type CreateCanteenApplicationInput struct {
	UserID               string
	SchoolID             string  `json:"school_id"`
	CampusID             *string `json:"campus_id"`
	RequestedSchoolName  string  `json:"requested_school_name"`
	RequestedCampusName  *string `json:"requested_campus_name"`
	RequestedCanteenName string  `json:"requested_canteen_name"`
	LocationText         *string `json:"location_text"`
	EvidenceURL          *string `json:"evidence_url"`
	ApplicantNote        *string `json:"applicant_note"`
}

func (s *CampusDirectoryService) ListCampuses(ctx context.Context, input ListCampusesInput) ([]domain.SchoolCampus, error) {
	schoolID := strings.TrimSpace(input.SchoolID)
	if schoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "学校 ID 不能为空", HTTPStatus: 400}
	}
	return s.repo.ListCampuses(ctx, repo.ListCampusesInput{SchoolID: schoolID, Status: "active"})
}

func (s *CampusDirectoryService) ListCanteens(ctx context.Context, input ListCanteensInput) ([]domain.SchoolCanteen, error) {
	schoolID := strings.TrimSpace(input.SchoolID)
	if schoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "学校 ID 不能为空", HTTPStatus: 400}
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.repo.ListCanteens(ctx, repo.ListCanteensInput{
		SchoolID: schoolID,
		CampusID: strings.TrimSpace(input.CampusID),
		Query:    strings.TrimSpace(input.Query),
		Limit:    limit,
		Status:   "active",
	})
}

func (s *CampusDirectoryService) ListWindows(ctx context.Context, input ListWindowsInput) ([]domain.CanteenWindow, error) {
	canteenID := strings.TrimSpace(input.CanteenID)
	if canteenID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂 ID 不能为空", HTTPStatus: 400}
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.repo.ListWindows(ctx, repo.ListWindowsInput{
		CanteenID: canteenID,
		Floor:     strings.TrimSpace(input.Floor),
		Query:     strings.TrimSpace(input.Query),
		Limit:     limit,
		Status:    "active",
	})
}

func (s *CampusDirectoryService) ListFloors(ctx context.Context, input ListFloorsInput) ([]domain.CanteenFloor, error) {
	canteenID := strings.TrimSpace(input.CanteenID)
	if canteenID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂 ID 不能为空", HTTPStatus: 400}
	}
	canteen, err := s.repo.GetCanteen(ctx, canteenID)
	if err != nil {
		return nil, err
	}
	if canteen == nil || canteen.Status != "active" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂不存在或尚未发布", HTTPStatus: 404}
	}
	windows, err := s.repo.ListWindows(ctx, repo.ListWindowsInput{CanteenID: canteenID, Status: "active", Limit: 100})
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	floors := extractCanteenFloors(canteen.BuildingOrFloor)
	for _, floor := range floors {
		seen[floor] = struct{}{}
	}
	for _, window := range windows {
		for _, floor := range extractCanteenFloors(window.Floor) {
			if _, ok := seen[floor]; !ok {
				floors = append(floors, floor)
				seen[floor] = struct{}{}
			}
		}
	}
	if len(floors) == 0 {
		return fallbackCanteenFloors(), nil
	}
	sort.SliceStable(floors, func(i, j int) bool { return floorSortRank(floors[i]) < floorSortRank(floors[j]) })
	rows := make([]domain.CanteenFloor, 0, len(floors))
	for index, floor := range floors {
		rows = append(rows, domain.CanteenFloor{Name: floor, SortOrder: index + 1})
	}
	return rows, nil
}

func fallbackCanteenFloors() []domain.CanteenFloor {
	names := []string{"负一楼", "一楼", "二楼", "三楼", "四楼", "五楼", "平层", "其他楼层"}
	rows := make([]domain.CanteenFloor, 0, len(names))
	for index, name := range names {
		rows = append(rows, domain.CanteenFloor{
			Name:       name,
			SortOrder:  index + 1,
			IsFallback: true,
			IsDefault:  name == "一楼",
		})
	}
	return rows
}

var (
	floorRangePattern = regexp.MustCompile(`(负?[一二三四五六七八九十两0-9]+)[至到~～-](负?[一二三四五六七八九十两0-9]+)楼`)
	floorNamePattern  = regexp.MustCompile(`负?(?:[一二三四五六七八九十两]+|[0-9]+)楼`)
	basementPattern   = regexp.MustCompile(`(?i)B[0-9]+`)
	floorCountPattern = regexp.MustCompile(`(?:共有|共|总计|合计|地上共?|地下共)[一二三四五六七八九十两0-9]+层`)
)

func extractCanteenFloors(raw string) []string {
	text := floorCountPattern.ReplaceAllString(strings.TrimSpace(raw), "")
	text = strings.NewReplacer("层", "楼", "地下", "负", "兩", "两").Replace(text)
	if text == "" {
		return nil
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, 4)
	add := func(value string) {
		value = normalizeFloorName(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	for _, match := range floorRangePattern.FindAllStringSubmatch(text, -1) {
		start, startOK := floorNumber(match[1])
		end, endOK := floorNumber(match[2])
		if !startOK || !endOK || end < start || end-start > 20 {
			continue
		}
		for current := start; current <= end; current++ {
			if current == 0 {
				continue
			}
			add(chineseFloorName(current))
		}
	}
	for _, value := range floorNamePattern.FindAllString(text, -1) {
		add(value)
	}
	for _, value := range basementPattern.FindAllString(text, -1) {
		add(value)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeFloorName(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "层", "楼"))
	if strings.HasPrefix(strings.ToUpper(value), "B") {
		n, err := strconv.Atoi(value[1:])
		if err == nil && n > 0 {
			return "负" + chineseNumber(n) + "楼"
		}
		return ""
	}
	if !strings.HasSuffix(value, "楼") {
		value += "楼"
	}
	return strings.ReplaceAll(value, "两", "二")
}

func floorNumber(value string) (int, bool) {
	negative := strings.HasPrefix(value, "负")
	value = strings.TrimPrefix(value, "负")
	if n, err := strconv.Atoi(value); err == nil {
		if negative {
			n = -n
		}
		return n, n != 0
	}
	digits := map[rune]int{'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	n := 0
	runes := []rune(value)
	if len(runes) == 1 {
		n = digits[runes[0]]
	} else if value == "十" {
		n = 10
	} else if strings.Contains(value, "十") {
		parts := strings.SplitN(value, "十", 2)
		tens := 1
		if parts[0] != "" {
			tens = digits[[]rune(parts[0])[0]]
		}
		n = tens * 10
		if parts[1] != "" {
			n += digits[[]rune(parts[1])[0]]
		}
	}
	if n == 0 {
		return 0, false
	}
	if negative {
		n = -n
	}
	return n, true
}

func chineseFloorName(number int) string {
	if number < 0 {
		return "负" + chineseNumber(-number) + "楼"
	}
	return chineseNumber(number) + "楼"
}

func chineseNumber(number int) string {
	digits := []string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}
	if number > 0 && number < 10 {
		return digits[number]
	}
	if number >= 10 && number < 20 {
		if number == 10 {
			return "十"
		}
		return "十" + digits[number-10]
	}
	if number >= 20 && number < 100 {
		if number%10 == 0 {
			return digits[number/10] + "十"
		}
		return digits[number/10] + "十" + digits[number%10]
	}
	return strconv.Itoa(number)
}

func floorSortRank(value string) int {
	n, ok := floorNumber(strings.TrimSuffix(value, "楼"))
	if !ok {
		return 10000
	}
	return n + 100
}

func (s *CampusDirectoryService) CreateApplication(ctx context.Context, input CreateCanteenApplicationInput) (*domain.CampusCanteenApplication, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.SchoolID = strings.TrimSpace(input.SchoolID)
	input.RequestedSchoolName = strings.TrimSpace(input.RequestedSchoolName)
	input.RequestedCanteenName = strings.TrimSpace(input.RequestedCanteenName)
	if input.UserID == "" {
		return nil, &commonerrors.AppError{Code: 10001, Message: "请先登录", HTTPStatus: 401}
	}
	if input.SchoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请选择学校", HTTPStatus: 400}
	}
	if input.RequestedSchoolName == "" {
		school, err := s.repo.GetSchool(ctx, input.SchoolID)
		if err != nil {
			return nil, err
		}
		if school == nil {
			return nil, &commonerrors.AppError{Code: 10002, Message: "学校不存在", HTTPStatus: 400}
		}
		input.RequestedSchoolName = school.Name
	}
	if input.RequestedCanteenName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请填写要申请的食堂名称", HTTPStatus: 400}
	}
	if len([]rune(input.RequestedCanteenName)) > 80 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂名称不能超过 80 字", HTTPStatus: 400}
	}
	return s.repo.CreateApplication(ctx, repo.CreateApplicationInput{
		UserID:               input.UserID,
		SchoolID:             input.SchoolID,
		CampusID:             trimStringPtr(input.CampusID),
		RequestedSchoolName:  input.RequestedSchoolName,
		RequestedCampusName:  trimStringPtr(input.RequestedCampusName),
		RequestedCanteenName: input.RequestedCanteenName,
		LocationText:         trimStringPtr(input.LocationText),
		EvidenceURL:          trimStringPtr(input.EvidenceURL),
		ApplicantNote:        trimStringPtr(input.ApplicantNote),
	})
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
