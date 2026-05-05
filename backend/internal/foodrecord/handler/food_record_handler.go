package handler

import (
	"context"
	"io"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/service"

	"github.com/gin-gonic/gin"
)

type FoodRecordService interface {
	Save(ctx context.Context, userID string, input service.SaveFoodRecordInput) (*domain.FoodRecord, error)
	List(ctx context.Context, userID, date string) ([]domain.FoodRecord, error)
	Get(ctx context.Context, userID, recordID string) (*domain.FoodRecord, error)
	Update(ctx context.Context, userID, recordID string, input service.UpdateFoodRecordInput) (*domain.FoodRecord, error)
	Delete(ctx context.Context, userID, recordID string) error
	Share(ctx context.Context, recordID string) (*domain.FoodRecord, error)
	SaveCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error
}

type UploadService interface {
	UploadBase64(base64Image string) (string, error)
	UploadFile(fileBytes []byte, ext, contentType string) (string, error)
}

type FoodNutritionService interface {
	Search(ctx context.Context, query string, limit int) ([]map[string]any, error)
	GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error)
}

type FoodRecordHandler struct {
	recordSvc   FoodRecordService
	uploadSvc   UploadService
	nutritionSvc FoodNutritionService
}

func NewFoodRecordHandler(
	recordSvc FoodRecordService,
	uploadSvc UploadService,
	nutritionSvc FoodNutritionService,
) *FoodRecordHandler {
	return &FoodRecordHandler{
		recordSvc:    recordSvc,
		uploadSvc:    uploadSvc,
		nutritionSvc: nutritionSvc,
	}
}

// POST /api/food-record/save
func (h *FoodRecordHandler) SaveFoodRecord(c *gin.Context) {
	var body struct {
		MealType         string           `json:"meal_type"`
		ImagePath        *string          `json:"image_path"`
		ImagePaths       []string         `json:"image_paths"`
		Description      *string          `json:"description"`
		Insight          *string          `json:"insight"`
		Items            []domain.FoodItem `json:"items"`
		TotalCalories    float64          `json:"total_calories"`
		TotalProtein     float64          `json:"total_protein"`
		TotalCarbs       float64          `json:"total_carbs"`
		TotalFat         float64          `json:"total_fat"`
		TotalWeightGrams int              `json:"total_weight_grams"`
		DietGoal         *string          `json:"diet_goal"`
		ActivityTiming   *string          `json:"activity_timing"`
		PFCRatioComment  *string          `json:"pfc_ratio_comment"`
		AbsorptionNotes  *string          `json:"absorption_notes"`
		ContextAdvice    *string          `json:"context_advice"`
		SourceTaskID     *string          `json:"source_task_id"`
		Date             *string          `json:"date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	record, err := h.recordSvc.Save(c.Request.Context(), userID, service.SaveFoodRecordInput{
		MealType:         body.MealType,
		ImagePath:        body.ImagePath,
		ImagePaths:       body.ImagePaths,
		Description:      body.Description,
		Insight:          body.Insight,
		Items:            body.Items,
		TotalCalories:    body.TotalCalories,
		TotalProtein:     body.TotalProtein,
		TotalCarbs:       body.TotalCarbs,
		TotalFat:         body.TotalFat,
		TotalWeightGrams: body.TotalWeightGrams,
		DietGoal:         body.DietGoal,
		ActivityTiming:   body.ActivityTiming,
		PFCRatioComment:  body.PFCRatioComment,
		AbsorptionNotes:  body.AbsorptionNotes,
		ContextAdvice:    body.ContextAdvice,
		SourceTaskID:     body.SourceTaskID,
		Date:             body.Date,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": record.ID, "message": "记录成功"})
}

// GET /api/food-record/list
func (h *FoodRecordHandler) ListFoodRecords(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := c.Query("date")
	records, err := h.recordSvc.List(c.Request.Context(), userID, date)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"records": records})
}

// GET /api/food-record/:record_id
func (h *FoodRecordHandler) GetFoodRecord(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	record, err := h.recordSvc.Get(c.Request.Context(), userID, recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"record": record})
}

// PUT /api/food-record/:record_id
func (h *FoodRecordHandler) UpdateFoodRecord(c *gin.Context) {
	var body struct {
		MealType         *string           `json:"meal_type"`
		Items            []domain.FoodItem `json:"items"`
		TotalCalories    *float64          `json:"total_calories"`
		TotalProtein     *float64          `json:"total_protein"`
		TotalCarbs       *float64          `json:"total_carbs"`
		TotalFat         *float64          `json:"total_fat"`
		TotalWeightGrams *int              `json:"total_weight_grams"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	record, err := h.recordSvc.Update(c.Request.Context(), userID, recordID, service.UpdateFoodRecordInput{
		MealType:         body.MealType,
		Items:            body.Items,
		TotalCalories:    body.TotalCalories,
		TotalProtein:     body.TotalProtein,
		TotalCarbs:       body.TotalCarbs,
		TotalFat:         body.TotalFat,
		TotalWeightGrams: body.TotalWeightGrams,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功", "record": record})
}

// DELETE /api/food-record/:record_id
func (h *FoodRecordHandler) DeleteFoodRecord(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	if err := h.recordSvc.Delete(c.Request.Context(), userID, recordID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

// GET /api/food-record/share/:record_id
func (h *FoodRecordHandler) ShareFoodRecord(c *gin.Context) {
	recordID := c.Param("record_id")
	record, err := h.recordSvc.Share(c.Request.Context(), recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"record": record})
}

// POST /api/upload-analyze-image
func (h *FoodRecordHandler) UploadAnalyzeImage(c *gin.Context) {
	var body struct {
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Base64Image == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "base64Image 不能为空", HTTPStatus: 400})
		return
	}
	imageURL, err := h.uploadSvc.UploadBase64(body.Base64Image)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"imageUrl": imageURL})
}

// POST /api/upload-analyze-image-file
func (h *FoodRecordHandler) UploadAnalyzeImageFile(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "图片文件不能为空", HTTPStatus: 400})
		return
	}
	if file.Header.Get("Content-Type") != "" && !strings.HasPrefix(file.Header.Get("Content-Type"), "image/") {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "仅支持图片文件上传", HTTPStatus: 400})
		return
	}
	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()

	fileBytes, err := io.ReadAll(opened)
	if err != nil {
		response.Error(c, err)
		return
	}
	if len(fileBytes) == 0 {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "图片文件为空", HTTPStatus: 400})
		return
	}

	ext := filepathExt(file.Filename)
	imageURL, err := h.uploadSvc.UploadFile(fileBytes, ext, file.Header.Get("Content-Type"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"imageUrl": imageURL})
}

// GET /api/food-nutrition/search
func (h *FoodRecordHandler) SearchFoodNutrition(c *gin.Context) {
	query := c.Query("query")
	limitStr := c.Query("limit")
	limit := 5
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.nutritionSvc.Search(c.Request.Context(), query, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// GET /api/food-nutrition/unresolved/top
func (h *FoodRecordHandler) GetUnresolvedTop(c *gin.Context) {
	limitStr := c.Query("limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.nutritionSvc.GetUnresolvedTop(c.Request.Context(), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// POST /api/critical-samples
func (h *FoodRecordHandler) SaveCriticalSamples(c *gin.Context) {
	var body struct {
		Items []domain.CriticalSample `json:"items"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.recordSvc.SaveCriticalSamples(c.Request.Context(), userID, body.Items); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已保存偏差样本", "count": len(body.Items)})
}

func filepathExt(filename string) string {
	if i := strings.LastIndex(filename, "."); i >= 0 {
		return filename[i:]
	}
	return ""
}
