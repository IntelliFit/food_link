package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SchoolHandler struct {
	db *gorm.DB
}

func NewSchoolHandler(db *gorm.DB) *SchoolHandler {
	return &SchoolHandler{db: db}
}

type SchoolSearchResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Province string `json:"province,omitempty"`
	City     string `json:"city,omitempty"`
}

func (h *SchoolHandler) Search(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	province := strings.TrimSpace(c.Query("province"))
	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	var rows []struct {
		ID       string
		Name     string
		Province *string
		City     *string
	}

	q := h.db.Table("schools").Select("id, name, province, city").Where("status = ?", "active")
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
		results = append(results, SchoolSearchResponse{
			ID:       r.ID,
			Name:     r.Name,
			Province: ptrString(r.Province),
			City:     ptrString(r.City),
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": results})
}

// Provinces 返回所有有学校的省份列表（去重、排序）
func (h *SchoolHandler) Provinces(c *gin.Context) {
	var rows []struct {
		Province *string
	}
	err := h.db.Table("schools").
		Select("DISTINCT province").
		Where("status = ? AND province IS NOT NULL AND province != ?", "active", "").
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

func ptrString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
