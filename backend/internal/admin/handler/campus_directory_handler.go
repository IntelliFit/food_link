package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	schooldomain "food_link/backend/internal/school/domain"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type CampusDirectoryHandler struct {
	db *gorm.DB
}

func NewCampusDirectoryHandler(db *gorm.DB) *CampusDirectoryHandler {
	return &CampusDirectoryHandler{db: db}
}

func (h *CampusDirectoryHandler) ListSchools(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	if limit > 100 {
		limit = 100
	}
	qText := strings.TrimSpace(c.Query("q"))
	status := strings.TrimSpace(c.DefaultQuery("status", "active"))
	locationType := strings.TrimSpace(c.Query("location_type"))
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.School{})
	if qText != "" {
		like := "%" + qText + "%"
		query = query.Where("name ILIKE ? OR province ILIKE ? OR city ILIKE ?", like, like, like)
	}
	if status != "all" {
		query = query.Where("status = ?", status)
	}
	if locationType != "" && locationType != "all" {
		query = query.Where("location_type = ?", normalizeAdminLocationType(locationType))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.School
	if err := query.Order("is_985 DESC, is_211 DESC, name ASC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) GetSchoolSummary(c *gin.Context) {
	schoolID := strings.TrimSpace(c.Param("school_id"))
	if schoolID == "" {
		response.Error(c, badRequest("学校 ID 不能为空"))
		return
	}
	var school schooldomain.School
	if err := h.db.WithContext(c.Request.Context()).Where("id = ? AND status <> ?", schoolID, "deleted").First(&school).Error; err != nil {
		response.Error(c, err)
		return
	}
	counts := map[string]int64{}
	queries := []struct {
		key   string
		table string
		where string
	}{
		{key: "campuses", table: "school_campuses", where: "school_id = ? AND status <> 'deleted'"},
		{key: "canteens", table: "school_canteens", where: "school_id = ? AND status <> 'deleted'"},
		{key: "windows", table: "canteen_windows", where: "school_id = ? AND status <> 'deleted'"},
		{key: "dishes", table: "campus_food_catalog_items", where: "school_id = ? AND status <> 'deleted'"},
	}
	for _, query := range queries {
		var count int64
		if err := h.db.WithContext(c.Request.Context()).Table(query.table).Where(query.where, schoolID).Count(&count).Error; err != nil {
			logger.Error(c.Request.Context(), "读取学校层级数量失败", err,
				slog.String("school_id", schoolID), slog.String("resource", query.key))
			response.Error(c, err)
			return
		}
		counts[query.key] = count
	}
	logger.Info(c.Request.Context(), "管理员读取学校层级摘要成功",
		slog.String("admin_id", c.GetString("admin_account_id")),
		slog.String("school_id", schoolID),
		slog.Int64("campus_count", counts["campuses"]),
		slog.Int64("canteen_count", counts["canteens"]),
		slog.Int64("window_count", counts["windows"]),
		slog.Int64("dish_count", counts["dishes"]),
	)
	response.Success(c, gin.H{"school": school, "counts": counts})
}

func (h *CampusDirectoryHandler) CreateSchool(c *gin.Context) {
	var body struct {
		Name         string  `json:"name"`
		LocationType string  `json:"location_type"`
		Province     string  `json:"province"`
		City         string  `json:"city"`
		Level        string  `json:"level"`
		Is985        bool    `json:"is_985"`
		Is211        bool    `json:"is_211"`
		Status       string  `json:"status"`
		LogoURL      *string `json:"logo_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		response.Error(c, badRequest("学校名称不能为空"))
		return
	}
	status := strings.TrimSpace(body.Status)
	if status == "" {
		status = "active"
	}
	row := map[string]any{
		"id":            uuid.New().String(),
		"name":          name,
		"location_type": normalizeAdminLocationType(body.LocationType),
		"province":      strings.TrimSpace(body.Province),
		"city":          strings.TrimSpace(body.City),
		"level":         strings.TrimSpace(body.Level),
		"is_985":        body.Is985,
		"is_211":        body.Is211,
		"status":        status,
		"logo_url":      trimStringPtr(body.LogoURL),
		"created_at":    time.Now(),
	}
	if err := h.db.WithContext(c.Request.Context()).Table("schools").Create(row).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": row})
}

func (h *CampusDirectoryHandler) UpdateSchool(c *gin.Context) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	patch := pickPatch(body, "name", "location_type", "province", "city", "level", "is_985", "is_211", "status", "logo_url")
	if raw, ok := patch["location_type"].(string); ok {
		patch["location_type"] = normalizeAdminLocationType(raw)
	}
	if len(patch) == 0 {
		response.Success(c, gin.H{"message": "无变更"})
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Table("schools").Where("id = ?", c.Param("school_id")).Updates(patch).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "保存成功"})
}

func (h *CampusDirectoryHandler) DeleteSchool(c *gin.Context) {
	schoolID := strings.TrimSpace(c.Param("school_id"))
	blocked, err := h.hasChildren(c, []childCheck{
		{table: "school_campuses", where: "school_id = ? AND status <> 'deleted'", id: schoolID},
		{table: "school_canteens", where: "school_id = ? AND status <> 'deleted'", id: schoolID},
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	if blocked {
		response.Error(c, badRequest("学校下仍有校区或食堂，请先处理子级数据"))
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Table("schools").Where("id = ?", schoolID).Update("status", "deleted").Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

func (h *CampusDirectoryHandler) ListCampuses(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.SchoolCampus{})
	if schoolID := strings.TrimSpace(c.Query("school_id")); schoolID != "" {
		query = query.Where("school_id = ?", schoolID)
	}
	if status := strings.TrimSpace(c.DefaultQuery("status", "all")); status != "all" {
		query = query.Where("status = ?", status)
	} else {
		query = query.Where("status <> ?", "deleted")
	}
	if qText := strings.TrimSpace(c.Query("q")); qText != "" {
		like := "%" + qText + "%"
		query = query.Where("name ILIKE ? OR address ILIKE ? OR CAST(aliases AS TEXT) ILIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.SchoolCampus
	if err := query.Order("school_id ASC, sort_order ASC, name ASC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) CreateCampus(c *gin.Context) {
	var body schooldomain.SchoolCampus
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.ID = uuid.New().String()
	body.Name = strings.TrimSpace(body.Name)
	body.SchoolID = strings.TrimSpace(body.SchoolID)
	if body.SchoolID == "" || body.Name == "" {
		response.Error(c, badRequest("学校和校区名称不能为空"))
		return
	}
	if err := h.requireActiveParent(c, "schools", "id = ? AND status <> 'deleted'", body.SchoolID, "所属学校不存在或已删除"); err != nil {
		response.Error(c, err)
		return
	}
	if strings.TrimSpace(body.Status) == "" {
		body.Status = "pending_review"
	}
	now := time.Now()
	body.CreatedAt = &now
	body.UpdatedAt = &now
	if body.Aliases == nil {
		body.Aliases = []string{}
	}
	if err := h.db.WithContext(c.Request.Context()).Create(&body).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": body})
}

func (h *CampusDirectoryHandler) UpdateCampus(c *gin.Context) {
	h.updateTableWithJSONLists(c, "school_campuses", "campus_id", []string{"aliases"}, "name", "aliases", "address", "campus_type", "source_url", "status", "sort_order")
}

func (h *CampusDirectoryHandler) DeleteCampus(c *gin.Context) {
	campusID := strings.TrimSpace(c.Param("campus_id"))
	blocked, err := h.hasChildren(c, []childCheck{{table: "school_canteens", where: "campus_id = ? AND status <> 'deleted'", id: campusID}})
	if err != nil {
		response.Error(c, err)
		return
	}
	if blocked {
		response.Error(c, badRequest("校区下仍有食堂，请先处理子级数据"))
		return
	}
	h.softDelete(c, "school_campuses", "campus_id")
}

func (h *CampusDirectoryHandler) ListCanteens(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).
		Table("school_canteens AS c").
		Select("c.*, COALESCE(sc.name, '') AS campus_name").
		Joins("LEFT JOIN school_campuses sc ON sc.id = c.campus_id")
	if schoolID := strings.TrimSpace(c.Query("school_id")); schoolID != "" {
		query = query.Where("c.school_id = ?", schoolID)
	}
	if campusID := strings.TrimSpace(c.Query("campus_id")); campusID != "" {
		query = query.Where("c.campus_id = ?", campusID)
	}
	if status := strings.TrimSpace(c.DefaultQuery("status", "all")); status != "all" {
		query = query.Where("c.status = ?", status)
	} else {
		query = query.Where("c.status <> ?", "deleted")
	}
	if qText := strings.TrimSpace(c.Query("q")); qText != "" {
		like := "%" + qText + "%"
		query = query.Where("c.name ILIKE ? OR c.location_text ILIKE ? OR CAST(c.aliases AS TEXT) ILIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.SchoolCanteen
	if err := query.Order("c.school_id ASC, COALESCE(sc.sort_order, 9999) ASC, c.sort_order ASC, c.name ASC").Offset((page - 1) * limit).Limit(limit).Scan(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) CreateCanteen(c *gin.Context) {
	var body schooldomain.SchoolCanteen
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.ID = uuid.New().String()
	body.Name = strings.TrimSpace(body.Name)
	body.SchoolID = strings.TrimSpace(body.SchoolID)
	campusID := strings.TrimSpace(derefString(body.CampusID))
	if body.SchoolID == "" || campusID == "" || body.Name == "" {
		response.Error(c, badRequest("学校、校区和食堂名称不能为空"))
		return
	}
	if err := h.requireActiveParent(c, "school_campuses", "id = ? AND school_id = ? AND status <> 'deleted'", []any{campusID, body.SchoolID}, "所属校区不属于当前学校或已删除"); err != nil {
		response.Error(c, err)
		return
	}
	if strings.TrimSpace(body.Status) == "" {
		body.Status = "pending_review"
	}
	if body.Aliases == nil {
		body.Aliases = []string{}
	}
	if body.MealPeriods == nil {
		body.MealPeriods = []string{}
	}
	if body.PaymentMethods == nil {
		body.PaymentMethods = []string{}
	}
	now := time.Now()
	body.CreatedAt = &now
	body.UpdatedAt = &now
	if err := h.db.WithContext(c.Request.Context()).Create(&body).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": body})
}

func (h *CampusDirectoryHandler) UpdateCanteen(c *gin.Context) {
	h.updateTableWithJSONLists(c, "school_canteens", "canteen_id", []string{"aliases", "meal_periods", "payment_methods"}, "campus_id", "name", "aliases", "location_text", "building_or_floor", "service_type", "audience", "meal_periods", "opening_hours_raw", "payment_methods", "halal_or_ethnic", "visitor_available", "source_url", "source_org", "source_type", "confidence_level", "status", "review_note", "sort_order")
}

func (h *CampusDirectoryHandler) DeleteCanteen(c *gin.Context) {
	canteenID := strings.TrimSpace(c.Param("canteen_id"))
	blocked, err := h.hasChildren(c, []childCheck{
		{table: "canteen_windows", where: "canteen_id = ? AND status <> 'deleted'", id: canteenID},
		{table: "campus_food_catalog_items", where: "canteen_id = ? AND status <> 'deleted'", id: canteenID},
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	if blocked {
		response.Error(c, badRequest("食堂下仍有窗口或菜品，请先处理子级数据"))
		return
	}
	h.softDelete(c, "school_canteens", "canteen_id")
}

func (h *CampusDirectoryHandler) ListCanteenDrafts(c *gin.Context) {
	page, limit := pageLimit(c)
	status := strings.TrimSpace(c.DefaultQuery("status", "pending_review"))
	query := h.db.WithContext(c.Request.Context()).
		Table("school_canteens AS c").
		Select("c.*, COALESCE(sc.name, '') AS campus_name, COALESCE(source_counts.source_count, 0) AS source_count").
		Joins("LEFT JOIN school_campuses sc ON sc.id = c.campus_id").
		Joins("LEFT JOIN (?) AS source_counts ON source_counts.canteen_id = c.id",
			h.db.Table("campus_directory_sources").Select("canteen_id, COUNT(*) AS source_count").Where("canteen_id IS NOT NULL").Group("canteen_id"),
		)
	if schoolID := strings.TrimSpace(c.Query("school_id")); schoolID != "" {
		query = query.Where("c.school_id = ?", schoolID)
	}
	if campusID := strings.TrimSpace(c.Query("campus_id")); campusID != "" {
		query = query.Where("c.campus_id = ?", campusID)
	}
	if batchID := strings.TrimSpace(c.Query("batch_id")); batchID != "" {
		query = query.Where("EXISTS (SELECT 1 FROM campus_directory_sources s WHERE s.canteen_id = c.id AND s.batch_id = ?)", batchID)
	}
	if status != "all" {
		query = query.Where("c.status = ?", status)
	} else {
		query = query.Where("c.status IN ?", []string{"pending_review", "rejected", "inactive"})
	}
	if qText := strings.TrimSpace(c.Query("q")); qText != "" {
		like := "%" + qText + "%"
		query = query.Where("c.name ILIKE ? OR c.location_text ILIKE ? OR CAST(c.aliases AS TEXT) ILIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.SchoolCanteen
	if err := query.Order("c.created_at DESC, c.name ASC").Offset((page - 1) * limit).Limit(limit).Scan(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) ReviewCanteenDraft(c *gin.Context) {
	var body struct {
		Status     string  `json:"status"`
		ReviewNote *string `json:"review_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	status := strings.TrimSpace(body.Status)
	if status != "active" && status != "rejected" && status != "pending_review" {
		response.Error(c, badRequest("审核状态无效"))
		return
	}
	canteenID := strings.TrimSpace(c.Param("canteen_id"))
	if canteenID == "" {
		response.Error(c, badRequest("食堂 ID 不能为空"))
		return
	}
	now := time.Now()
	patch := map[string]any{
		"status":      status,
		"review_note": trimStringPtr(body.ReviewNote),
		"reviewed_by": nilIfEmpty(c.GetString("admin_account_id")),
		"reviewed_at": &now,
		"updated_at":  now,
	}
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("school_canteens").Where("id = ?", canteenID).Updates(patch).Error; err != nil {
			return err
		}
		if status == "active" {
			if err := tx.Table("campus_directory_sources").Where("canteen_id = ?", canteenID).Updates(map[string]any{"review_status": "approved", "updated_at": now}).Error; err != nil {
				return err
			}
		}
		if status == "rejected" {
			if err := tx.Table("campus_directory_sources").Where("canteen_id = ?", canteenID).Updates(map[string]any{"review_status": "rejected", "updated_at": now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "草稿状态已更新"})
}

func (h *CampusDirectoryHandler) MergeCanteen(c *gin.Context) {
	var body struct {
		TargetCanteenID string  `json:"target_canteen_id"`
		ReviewNote      *string `json:"review_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	sourceID := strings.TrimSpace(c.Param("canteen_id"))
	targetID := strings.TrimSpace(body.TargetCanteenID)
	if sourceID == "" || targetID == "" || sourceID == targetID {
		response.Error(c, badRequest("请选择不同的目标食堂"))
		return
	}
	now := time.Now()
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var source, target schooldomain.SchoolCanteen
		if err := tx.Where("id = ?", sourceID).First(&source).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", targetID).First(&target).Error; err != nil {
			return err
		}
		if source.SchoolID != target.SchoolID {
			return badRequest("只能合并同一学校内的食堂")
		}
		if source.CampusID != nil && target.CampusID != nil && *source.CampusID != *target.CampusID {
			return badRequest("只能合并同一校区内的食堂")
		}
		if err := tx.Table("campus_directory_sources").Where("canteen_id = ?", sourceID).Updates(map[string]any{"canteen_id": targetID, "review_status": "approved", "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Table("campus_canteen_applications").Where("canteen_id = ?", sourceID).Updates(map[string]any{"canteen_id": targetID, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Table("public_food_library").Where("canteen_id = ?", sourceID).Updates(map[string]any{"canteen_id": targetID, "updated_at": now}).Error; err != nil {
			return err
		}
		patch := map[string]any{
			"status":      "deleted",
			"review_note": trimStringPtr(body.ReviewNote),
			"reviewed_by": nilIfEmpty(c.GetString("admin_account_id")),
			"reviewed_at": &now,
			"updated_at":  now,
		}
		return tx.Table("school_canteens").Where("id = ?", sourceID).Updates(patch).Error
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "食堂已合并"})
}

func (h *CampusDirectoryHandler) ListWindows(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.CanteenWindow{})
	if canteenID := strings.TrimSpace(c.Query("canteen_id")); canteenID != "" {
		query = query.Where("canteen_id = ?", canteenID)
	}
	if status := strings.TrimSpace(c.DefaultQuery("status", "all")); status != "all" {
		query = query.Where("status = ?", status)
	} else {
		query = query.Where("status <> ?", "deleted")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.CanteenWindow
	if err := query.Order("canteen_id ASC, sort_order ASC, floor ASC, name ASC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) CreateWindow(c *gin.Context) {
	var body schooldomain.CanteenWindow
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.ID = uuid.New().String()
	body.Name = strings.TrimSpace(body.Name)
	body.SchoolID = strings.TrimSpace(body.SchoolID)
	body.CanteenID = strings.TrimSpace(body.CanteenID)
	campusID := strings.TrimSpace(derefString(body.CampusID))
	if body.SchoolID == "" || campusID == "" || body.CanteenID == "" || body.Name == "" {
		response.Error(c, badRequest("学校、校区、食堂和窗口名称不能为空"))
		return
	}
	if err := h.requireActiveParent(c, "school_canteens", "id = ? AND school_id = ? AND campus_id = ? AND status <> 'deleted'", []any{body.CanteenID, body.SchoolID, campusID}, "所属食堂不属于当前学校和校区或已删除"); err != nil {
		response.Error(c, err)
		return
	}
	if strings.TrimSpace(body.Status) == "" {
		body.Status = "active"
	}
	if body.Aliases == nil {
		body.Aliases = []string{}
	}
	now := time.Now()
	body.CreatedAt = &now
	body.UpdatedAt = &now
	if err := h.db.WithContext(c.Request.Context()).Create(&body).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": body})
}

func (h *CampusDirectoryHandler) UpdateWindow(c *gin.Context) {
	h.updateTableWithJSONLists(c, "canteen_windows", "window_id", []string{"aliases"}, "name", "aliases", "floor", "source_url", "status", "sort_order")
}

func (h *CampusDirectoryHandler) DeleteWindow(c *gin.Context) {
	windowID := strings.TrimSpace(c.Param("window_id"))
	blocked, err := h.hasChildren(c, []childCheck{{table: "campus_food_catalog_items", where: "window_id = ? AND status <> 'deleted'", id: windowID}})
	if err != nil {
		response.Error(c, err)
		return
	}
	if blocked {
		response.Error(c, badRequest("窗口下仍有菜品，请先处理子级数据"))
		return
	}
	h.softDelete(c, "canteen_windows", "window_id")
}

func (h *CampusDirectoryHandler) ListApplications(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.CampusCanteenApplication{})
	if status := strings.TrimSpace(c.DefaultQuery("status", "pending")); status != "all" {
		query = query.Where("status = ?", status)
	}
	if schoolID := strings.TrimSpace(c.Query("school_id")); schoolID != "" {
		query = query.Where("school_id = ?", schoolID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.CampusCanteenApplication
	if err := query.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) UpdateApplication(c *gin.Context) {
	var body struct {
		Status     string  `json:"status"`
		CanteenID  *string `json:"canteen_id"`
		ReviewNote *string `json:"review_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	status := strings.TrimSpace(body.Status)
	if status != "approved" && status != "rejected" && status != "pending" {
		response.Error(c, badRequest("审核状态无效"))
		return
	}
	var app schooldomain.CampusCanteenApplication
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", c.Param("application_id")).First(&app).Error; err != nil {
		response.Error(c, err)
		return
	}
	patch := map[string]any{"status": status, "review_note": trimStringPtr(body.ReviewNote), "updated_at": time.Now()}
	if body.CanteenID != nil {
		patch["canteen_id"] = trimStringPtr(body.CanteenID)
	}
	if status == "approved" {
		canteenID := strings.TrimSpace(derefString(body.CanteenID))
		if canteenID == "" && app.CanteenID != nil {
			canteenID = strings.TrimSpace(*app.CanteenID)
		}
		if canteenID == "" {
			createdID, err := h.createCanteenFromApplication(c, app)
			if err != nil {
				response.Error(c, err)
				return
			}
			canteenID = createdID
		}
		patch["canteen_id"] = canteenID
		now := time.Now()
		patch["reviewed_at"] = &now
	} else if status == "rejected" {
		now := time.Now()
		patch["reviewed_at"] = &now
	}
	if err := h.db.WithContext(c.Request.Context()).Table("campus_canteen_applications").Where("id = ?", app.ID).Updates(patch).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "审核状态已更新"})
}

func (h *CampusDirectoryHandler) ListImportBatches(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.CampusDirectoryImportBatch{})
	if status := strings.TrimSpace(c.DefaultQuery("status", "all")); status != "all" {
		query = query.Where("status = ?", status)
	}
	if region := strings.TrimSpace(c.Query("region")); region != "" {
		query = query.Where("region ILIKE ?", "%"+region+"%")
	}
	if qText := strings.TrimSpace(c.Query("q")); qText != "" {
		like := "%" + qText + "%"
		query = query.Where("name ILIKE ? OR region ILIKE ? OR source_scope ILIKE ? OR notes ILIKE ?", like, like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.CampusDirectoryImportBatch
	if err := query.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) CreateImportBatch(c *gin.Context) {
	var body schooldomain.CampusDirectoryImportBatch
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.ID = uuid.New().String()
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		response.Error(c, badRequest("批次名称不能为空"))
		return
	}
	if strings.TrimSpace(body.Status) == "" {
		body.Status = "pending_review"
	}
	adminID := c.GetString("admin_account_id")
	if adminID != "" {
		body.CreatedBy = &adminID
	}
	now := time.Now()
	body.CreatedAt = &now
	body.UpdatedAt = &now
	if err := h.db.WithContext(c.Request.Context()).Create(&body).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": body})
}

func (h *CampusDirectoryHandler) UpdateImportBatch(c *gin.Context) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	patch := pickPatch(body, "name", "region", "source_scope", "status", "total_schools", "total_campuses", "total_canteens", "total_windows", "total_sources", "notes")
	if len(patch) == 0 {
		response.Success(c, gin.H{"message": "无变更"})
		return
	}
	now := time.Now()
	if status, ok := patch["status"].(string); ok && (status == "approved" || status == "rejected" || status == "archived") {
		patch["reviewed_by"] = nilIfEmpty(c.GetString("admin_account_id"))
		patch["reviewed_at"] = &now
	}
	patch["updated_at"] = now
	if err := h.db.WithContext(c.Request.Context()).Table("campus_directory_import_batches").Where("id = ?", c.Param("batch_id")).Updates(patch).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "保存成功"})
}

func (h *CampusDirectoryHandler) ListImports(c *gin.Context) {
	page, limit := pageLimit(c)
	query := h.db.WithContext(c.Request.Context()).Model(&schooldomain.CampusDirectorySource{})
	if batchID := strings.TrimSpace(c.Query("batch_id")); batchID != "" {
		query = query.Where("batch_id = ?", batchID)
	}
	if schoolID := strings.TrimSpace(c.Query("school_id")); schoolID != "" {
		query = query.Where("school_id = ?", schoolID)
	}
	if campusID := strings.TrimSpace(c.Query("campus_id")); campusID != "" {
		query = query.Where("campus_id = ?", campusID)
	}
	if canteenID := strings.TrimSpace(c.Query("canteen_id")); canteenID != "" {
		query = query.Where("canteen_id = ?", canteenID)
	}
	if status := strings.TrimSpace(c.DefaultQuery("review_status", "all")); status != "all" {
		query = query.Where("review_status = ?", status)
	}
	if qText := strings.TrimSpace(c.Query("q")); qText != "" {
		like := "%" + qText + "%"
		query = query.Where("source_url ILIKE ? OR source_title ILIKE ? OR source_org ILIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		response.Error(c, err)
		return
	}
	var rows []schooldomain.CampusDirectorySource
	if err := query.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": rows, "page": page, "limit": limit, "total": total})
}

func (h *CampusDirectoryHandler) CreateImport(c *gin.Context) {
	var body schooldomain.CampusDirectorySource
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	body.ID = uuid.New().String()
	body.SchoolID = strings.TrimSpace(body.SchoolID)
	body.SourceURL = strings.TrimSpace(body.SourceURL)
	if body.SchoolID == "" || body.SourceURL == "" {
		response.Error(c, badRequest("学校和证据 URL 不能为空"))
		return
	}
	if strings.TrimSpace(body.ReviewStatus) == "" {
		body.ReviewStatus = "pending_review"
	}
	now := time.Now()
	body.CollectedAt = &now
	body.CreatedAt = &now
	if err := h.db.WithContext(c.Request.Context()).Create(&body).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": body})
}

func (h *CampusDirectoryHandler) UpdateImport(c *gin.Context) {
	h.updateTable(c, "campus_directory_sources", "import_id", "batch_id", "school_id", "campus_id", "canteen_id", "source_url", "source_title", "source_org", "source_type", "evidence_level", "evidence_excerpt", "review_status", "source_published_at")
}

func (h *CampusDirectoryHandler) createCanteenFromApplication(c *gin.Context, app schooldomain.CampusCanteenApplication) (string, error) {
	id := uuid.New().String()
	now := time.Now()
	row := schooldomain.SchoolCanteen{
		ID:             id,
		SchoolID:       app.SchoolID,
		CampusID:       app.CampusID,
		Name:           strings.TrimSpace(app.RequestedCanteenName),
		Aliases:        []string{},
		LocationText:   strings.TrimSpace(app.LocationText),
		MealPeriods:    []string{},
		PaymentMethods: []string{},
		SourceURL:      strings.TrimSpace(app.EvidenceURL),
		SourceType:     "user_application",
		Status:         "active",
		CreatedAt:      &now,
		UpdatedAt:      &now,
	}
	return id, h.db.WithContext(c.Request.Context()).Create(&row).Error
}

func (h *CampusDirectoryHandler) updateTable(c *gin.Context, table string, idParam string, fields ...string) {
	h.updateTableWithJSONLists(c, table, idParam, nil, fields...)
}

func (h *CampusDirectoryHandler) updateTableWithJSONLists(c *gin.Context, table string, idParam string, jsonListFields []string, fields ...string) {
	resourceID := strings.TrimSpace(c.Param(idParam))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	patch := pickPatch(body, fields...)
	if err := normalizeJSONListPatch(patch, jsonListFields...); err != nil {
		response.Error(c, err)
		return
	}
	if len(patch) == 0 {
		response.Success(c, gin.H{"message": "无变更"})
		return
	}
	patch["updated_at"] = time.Now()
	if err := h.db.WithContext(c.Request.Context()).Table(table).Where("id = ?", resourceID).Updates(patch).Error; err != nil {
		logger.Error(c.Request.Context(), "管理员保存校园目录失败", err,
			slog.String("admin_id", c.GetString("admin_account_id")),
			slog.String("resource_type", table),
			slog.String("resource_id", resourceID),
		)
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员保存校园目录成功",
		slog.String("admin_id", c.GetString("admin_account_id")),
		slog.String("resource_type", table),
		slog.String("resource_id", resourceID),
		slog.Int("updated_field_count", len(patch)-1),
	)
	response.Success(c, gin.H{"message": "保存成功"})
}

func normalizeJSONListPatch(patch map[string]any, fields ...string) error {
	for _, field := range fields {
		value, exists := patch[field]
		if !exists {
			continue
		}
		if value == nil {
			delete(patch, field)
			continue
		}

		var encoded []byte
		if text, ok := value.(string); ok {
			text = strings.TrimSpace(text)
			if text == "" || text == "null" {
				delete(patch, field)
				continue
			}
			var decoded []any
			if err := json.Unmarshal([]byte(text), &decoded); err != nil {
				return badRequest(field + " 必须是数组")
			}
			encoded = []byte(text)
		} else {
			var err error
			encoded, err = json.Marshal(value)
			if err != nil {
				return badRequest(field + " 必须是数组")
			}
			var decoded []any
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				return badRequest(field + " 必须是数组")
			}
		}
		patch[field] = datatypes.JSON(encoded)
	}
	return nil
}

func (h *CampusDirectoryHandler) softDelete(c *gin.Context, table string, idParam string) {
	if err := h.db.WithContext(c.Request.Context()).Table(table).Where("id = ?", c.Param(idParam)).Updates(map[string]any{"status": "deleted", "updated_at": time.Now()}).Error; err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

type childCheck struct {
	table string
	where string
	id    string
}

func (h *CampusDirectoryHandler) hasChildren(c *gin.Context, checks []childCheck) (bool, error) {
	for _, check := range checks {
		var count int64
		if err := h.db.WithContext(c.Request.Context()).Table(check.table).Where(check.where, check.id).Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (h *CampusDirectoryHandler) requireActiveParent(c *gin.Context, table, where string, args any, message string) error {
	queryArgs, ok := args.([]any)
	if !ok {
		queryArgs = []any{args}
	}
	var count int64
	if err := h.db.WithContext(c.Request.Context()).Table(table).Where(where, queryArgs...).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return badRequest(message)
	}
	return nil
}

func pageLimit(c *gin.Context) (int, int) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	if limit > 100 {
		limit = 100
	}
	return page, limit
}

func pickPatch(body map[string]any, fields ...string) map[string]any {
	allowed := map[string]bool{}
	for _, field := range fields {
		allowed[field] = true
	}
	patch := map[string]any{}
	for key, value := range body {
		if allowed[key] {
			if text, ok := value.(string); ok {
				patch[key] = strings.TrimSpace(text)
			} else {
				patch[key] = value
			}
		}
	}
	return patch
}

func trimStringPtr(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nilIfEmpty(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}

func normalizeAdminLocationType(value string) string {
	switch strings.TrimSpace(value) {
	case "company", "community":
		return strings.TrimSpace(value)
	default:
		return "university"
	}
}
