package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	schooldomain "food_link/backend/internal/school/domain"
	schoolrepo "food_link/backend/internal/school/repo"
	schoolservice "food_link/backend/internal/school/service"
	"food_link/backend/pkg/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SchoolHandler struct {
	db            *gorm.DB
	storageClient *storage.Client
	directory     CampusDirectoryService
}

func NewSchoolHandler(db *gorm.DB, storageClient *storage.Client) *SchoolHandler {
	directoryRepo := schoolrepo.NewCampusDirectoryRepo(db)
	return &SchoolHandler{
		db:            db,
		storageClient: storageClient,
		directory:     schoolservice.NewCampusDirectoryService(directoryRepo),
	}
}

type CampusDirectoryService interface {
	GetCampus(ctx context.Context, campusID string) (*schooldomain.SchoolCampus, error)
	ListCampuses(ctx context.Context, input schoolservice.ListCampusesInput) ([]schooldomain.SchoolCampus, error)
	ListCanteens(ctx context.Context, input schoolservice.ListCanteensInput) ([]schooldomain.SchoolCanteen, error)
	ListFloors(ctx context.Context, input schoolservice.ListFloorsInput) ([]schooldomain.CanteenFloor, error)
	ListWindows(ctx context.Context, input schoolservice.ListWindowsInput) ([]schooldomain.CanteenWindow, error)
	CreateApplication(ctx context.Context, input schoolservice.CreateCanteenApplicationInput) (*schooldomain.CampusCanteenApplication, error)
}

type SchoolSearchResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	LocationType string `json:"location_type"`
	Province     string `json:"province,omitempty"`
	City         string `json:"city,omitempty"`
	LogoURL      string `json:"logo_url,omitempty"`
}

func (h *SchoolHandler) Search(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	province := strings.TrimSpace(c.Query("province"))
	locationType := normalizeLocationType(c.DefaultQuery("location_type", "university"))
	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	var rows []struct {
		ID           string
		Name         string
		Province     *string
		City         *string
		LogoURL      *string
		LocationType string
	}

	q := h.db.Table("schools").Select("id, name, location_type, province, city, logo_url").Where("status = ? AND location_type = ?", "active", locationType)
	if keyword != "" {
		q = q.Where("LOWER(name) LIKE LOWER(?)", "%"+keyword+"%")
	}
	if province != "" {
		q = q.Where("province = ?", province)
	}
	err := q.Order("is_985 DESC, is_211 DESC, name ASC").Limit(limit).Find(&rows).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "搜索学校失败"})
		return
	}

	results := make([]SchoolSearchResponse, 0, len(rows))
	for _, r := range rows {
		logoURL := ""
		if h.storageClient != nil && r.LogoURL != nil {
			logoURL = h.storageClient.NormalizeURL("food-images", *r.LogoURL)
		} else {
			logoURL = ptrString(r.LogoURL)
		}
		results = append(results, SchoolSearchResponse{
			ID:           r.ID,
			Name:         r.Name,
			LocationType: r.LocationType,
			Province:     ptrString(r.Province),
			City:         ptrString(r.City),
			LogoURL:      logoURL,
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": results})
}

// Provinces 返回所有有学校的省份列表（去重、排序）
func (h *SchoolHandler) Provinces(c *gin.Context) {
	locationType := normalizeLocationType(c.DefaultQuery("location_type", "university"))
	var rows []struct {
		Province *string
	}
	err := h.db.Table("schools").
		Select("DISTINCT province").
		Where("status = ? AND location_type = ? AND province IS NOT NULL AND province != ?", "active", locationType, "").
		Order("province ASC").
		Find(&rows).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取省份列表失败"})
		return
	}

	provinces := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Province != nil && *r.Province != "" {
			provinces = append(provinces, *r.Province)
		}
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": provinces})
}

func (h *SchoolHandler) Campuses(c *gin.Context) {
	rows, err := h.directory.ListCampuses(c.Request.Context(), schoolservice.ListCampusesInput{
		SchoolID: c.Param("school_id"),
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, rows)
}

func (h *SchoolHandler) Canteens(c *gin.Context) {
	rows, err := h.directory.ListCanteens(c.Request.Context(), schoolservice.ListCanteensInput{
		SchoolID: c.Param("school_id"),
		CampusID: c.Query("campus_id"),
		Query:    c.Query("q"),
		Limit:    intQuery(c, "limit", 100),
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, rows)
}

func (h *SchoolHandler) CampusCanteens(c *gin.Context) {
	campusID := strings.TrimSpace(c.Param("campus_id"))
	campus, err := h.directory.GetCampus(c.Request.Context(), campusID)
	if err != nil {
		response.Error(c, err)
		return
	}
	if campus == nil || campus.Status != "active" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "地点分区不存在", HTTPStatus: http.StatusBadRequest})
		return
	}
	rows, err := h.directory.ListCanteens(c.Request.Context(), schoolservice.ListCanteensInput{
		SchoolID: campus.SchoolID,
		CampusID: campusID,
		Query:    c.Query("q"),
		Limit:    intQuery(c, "limit", 100),
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, rows)
}

func normalizeLocationType(value string) string {
	switch strings.TrimSpace(value) {
	case "company", "community":
		return strings.TrimSpace(value)
	default:
		return "university"
	}
}

func (h *SchoolHandler) CanteenWindows(c *gin.Context) {
	rows, err := h.directory.ListWindows(c.Request.Context(), schoolservice.ListWindowsInput{
		CanteenID: c.Param("canteen_id"),
		Floor:     c.Query("floor"),
		Query:     c.Query("q"),
		Limit:     intQuery(c, "limit", 100),
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, rows)
}

func (h *SchoolHandler) CanteenFloors(c *gin.Context) {
	rows, err := h.directory.ListFloors(c.Request.Context(), schoolservice.ListFloorsInput{CanteenID: c.Param("canteen_id")})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, rows)
}

func (h *SchoolHandler) CreateCanteenApplication(c *gin.Context) {
	var body schoolservice.CreateCanteenApplicationInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.UserID = c.GetString(authmw.ContextUserIDKey)
	row, err := h.directory.CreateApplication(c.Request.Context(), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "申请已提交，审核通过后会出现在食堂列表中", "application": row})
}

func ptrString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func intQuery(c *gin.Context, key string, fallback int) int {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
