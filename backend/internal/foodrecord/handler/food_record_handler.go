package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/service"

	"github.com/gin-gonic/gin"
	"log/slog"
)

func roundWeightGramsPtr(v *float64) *int {
	if v == nil {
		return nil
	}
	rounded := int(math.Round(*v))
	return &rounded
}

type FoodRecordService interface {
	Save(ctx context.Context, userID string, input service.SaveFoodRecordInput) (*domain.FoodRecord, error)
	List(ctx context.Context, userID, date string) ([]domain.FoodRecord, error)
	Get(ctx context.Context, userID, recordID string) (*domain.FoodRecord, error)
	Update(ctx context.Context, userID, recordID string, input service.UpdateFoodRecordInput) (*domain.FoodRecord, error)
	Delete(ctx context.Context, userID, recordID string) error
	Share(ctx context.Context, recordID string) (*domain.FoodRecord, error)
	SaveCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error
	GetEntryDistribution(ctx context.Context, userID, startDate, endDate string) (*service.EntryDistributionResult, error)
}

type UploadService interface {
	UploadBase64(base64Image string) (string, error)
	UploadFile(fileBytes []byte, ext, contentType string) (string, error)
}

type FoodNutritionService interface {
	Search(ctx context.Context, query string, limit int) ([]map[string]any, error)
	GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error)
	CreatePackagedFood(ctx context.Context, input service.PackagedFoodInput) (*domain.PackagedFood, error)
	RecognizePackagedNutritionLabel(ctx context.Context, imageURL string) (*service.PackagedNutritionLabelResult, error)
	SubmitPackagedNutritionLabelTask(ctx context.Context, userID, imageURL string) (string, error)
	SubmitPackagedProductExtractTask(ctx context.Context, userID string, input service.SubmitPackagedProductExtractInput) (string, error)
}

type FoodRecordHandler struct {
	recordSvc    FoodRecordService
	uploadSvc    UploadService
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
		MealType         string            `json:"meal_type"`
		ImagePath        *string           `json:"image_path"`
		ImagePaths       []string          `json:"image_paths"`
		Description      *string           `json:"description"`
		Insight          *string           `json:"insight"`
		Items            []domain.FoodItem `json:"items"`
		TotalCalories    float64           `json:"total_calories"`
		TotalProtein     float64           `json:"total_protein"`
		TotalCarbs       float64           `json:"total_carbs"`
		TotalFat         float64           `json:"total_fat"`
		TotalWeightGrams float64           `json:"total_weight_grams"`
		DietGoal         *string           `json:"diet_goal"`
		ActivityTiming   *string           `json:"activity_timing"`
		PFCRatioComment  *string           `json:"pfc_ratio_comment"`
		AbsorptionNotes  *string           `json:"absorption_notes"`
		ContextAdvice    *string           `json:"context_advice"`
		SourceTaskID     *string           `json:"source_task_id"`
		EntryType        *string           `json:"entry_type"`
		RecipeID         *string           `json:"recipe_id"`
		Date             *string           `json:"date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logFoodRecordAPI(c, "save",
		slog.String("meal_type", body.MealType),
		slog.Int("item_count", len(body.Items)),
		slog.Float64("total_calories", body.TotalCalories),
	)
	if body.SourceTaskID != nil && strings.TrimSpace(*body.SourceTaskID) != "" {
		bindAnalysisTaskID(c, *body.SourceTaskID)
	}
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
		TotalWeightGrams: int(math.Round(body.TotalWeightGrams)),
		DietGoal:         body.DietGoal,
		ActivityTiming:   body.ActivityTiming,
		PFCRatioComment:  body.PFCRatioComment,
		AbsorptionNotes:  body.AbsorptionNotes,
		ContextAdvice:    body.ContextAdvice,
		SourceTaskID:     body.SourceTaskID,
		EntryType:        body.EntryType,
		RecipeID:         body.RecipeID,
		Date:             body.Date,
	})
	if err != nil {
		logFoodRecordAPIError(c, "save", err, taskIDAttr(c))
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "save_ok", slog.String("record_id", record.ID), taskIDAttr(c))
	response.Success(c, gin.H{
		"id":            record.ID,
		"message":       "记录成功",
		"already_saved": record.AlreadySaved,
	})
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

// GET /api/food-record/entry-distribution
func (h *FoodRecordHandler) EntryDistribution(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	result, err := h.recordSvc.GetEntryDistribution(c.Request.Context(), userID, startDate, endDate)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
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
		TotalWeightGrams *float64          `json:"total_weight_grams"`
		Description      *string           `json:"description"`
		ImagePath        *string           `json:"image_path"`
		ImagePaths       []string          `json:"image_paths"`
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
		TotalWeightGrams: roundWeightGramsPtr(body.TotalWeightGrams),
		Description:      body.Description,
		ImagePath:        body.ImagePath,
		ImagePaths:       body.ImagePaths,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "update_ok",
		slog.String("record_id", record.ID),
		slog.String("meal_type", record.MealType),
		slog.Int("item_count", len(record.Items)),
		slog.Int("total_weight_grams", record.TotalWeightGrams),
	)
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
	logFoodRecordAPI(c, "delete_ok", slog.String("record_id", recordID))
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
	logFoodRecordAPI(c, "share_ok",
		slog.String("record_id", record.ID),
		slog.String("meal_type", record.MealType),
	)
	response.Success(c, gin.H{"record": record})
}

// GET /share/food-record/:record_id
func (h *FoodRecordHandler) ShareFoodRecordPage(c *gin.Context) {
	recordID := c.Param("record_id")
	record, err := h.recordSvc.Share(c.Request.Context(), recordID)
	if err != nil {
		renderFoodRecordSharePageError(c, recordID, err)
		return
	}
	data := buildFoodRecordSharePageData(c, record)
	var buf bytes.Buffer
	if err := foodRecordSharePageTemplate.Execute(&buf, data); err != nil {
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "share_page_ok",
		slog.String("record_id", record.ID),
		slog.String("meal_type", record.MealType),
	)
	c.Data(200, "text/html; charset=utf-8", buf.Bytes())
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
	logFoodRecordAPI(c, "upload_analyze_image_ok",
		slog.Int("image.base64.length", len(body.Base64Image)),
	)
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
	logFoodRecordAPI(c, "upload_analyze_image_file_ok",
		slog.Int("file.size", len(fileBytes)),
		slog.String("file.content_type", file.Header.Get("Content-Type")),
	)
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

// POST /api/packaged-food
func (h *FoodRecordHandler) CreatePackagedFood(c *gin.Context) {
	var body struct {
		Brand                 string         `json:"brand"`
		ProductName           string         `json:"product_name"`
		DisplayName           string         `json:"display_name"`
		SearchText            string         `json:"search_text"`
		ProductFamilyKey      string         `json:"product_family_key"`
		SpecText              string         `json:"spec_text"`
		Barcode               string         `json:"barcode"`
		FlavorText            string         `json:"flavor_text"`
		PackageCategory       string         `json:"package_category"`
		IngredientsText       string         `json:"ingredients_text"`
		SourceImageURLs       []string       `json:"source_image_urls"`
		OCRRawText            string         `json:"ocr_raw_text"`
		NutritionBasisUnit    string         `json:"nutrition_basis_unit"`
		EnergyUnitRaw         string         `json:"energy_unit_raw"`
		RawLabelPayload       map[string]any `json:"raw_label_payload"`
		ConversionStatus      string         `json:"conversion_status"`
		ExtractConfidence     float64        `json:"extract_confidence"`
		FieldConfidence       map[string]any `json:"field_confidence"`
		IngestMethod          string         `json:"ingest_method"`
		NetContentValue       float64        `json:"net_content_value"`
		NetContentUnit        string         `json:"net_content_unit"`
		UnitCount             float64        `json:"unit_count"`
		UnitContentValue      float64        `json:"unit_content_value"`
		UnitContentUnit       string         `json:"unit_content_unit"`
		ReviewStatus          string         `json:"review_status"`
		NetWeightG            float64        `json:"net_weight_g"`
		ServingWeightG        float64        `json:"serving_weight_g"`
		KcalPer100g           float64        `json:"kcal_per_100g"`
		ProteinPer100g        float64        `json:"protein_per_100g"`
		CarbsPer100g          float64        `json:"carbs_per_100g"`
		FatPer100g            float64        `json:"fat_per_100g"`
		FiberPer100g          float64        `json:"fiber_per_100g"`
		SugarPer100g          float64        `json:"sugar_per_100g"`
		SaturatedFatPer100g   float64        `json:"saturated_fat_per_100g"`
		CholesterolMgPer100g  float64        `json:"cholesterol_mg_per_100g"`
		SodiumMgPer100g       float64        `json:"sodium_mg_per_100g"`
		PotassiumMgPer100g    float64        `json:"potassium_mg_per_100g"`
		CalciumMgPer100g      float64        `json:"calcium_mg_per_100g"`
		IronMgPer100g         float64        `json:"iron_mg_per_100g"`
		MagnesiumMgPer100g    float64        `json:"magnesium_mg_per_100g"`
		ZincMgPer100g         float64        `json:"zinc_mg_per_100g"`
		VitaminARaeMcgPer100g float64        `json:"vitamin_a_rae_mcg_per_100g"`
		VitaminCMgPer100g     float64        `json:"vitamin_c_mg_per_100g"`
		VitaminDMcgPer100g    float64        `json:"vitamin_d_mcg_per_100g"`
		VitaminEMgPer100g     float64        `json:"vitamin_e_mg_per_100g"`
		VitaminKMcgPer100g    float64        `json:"vitamin_k_mcg_per_100g"`
		ThiaminMgPer100g      float64        `json:"thiamin_mg_per_100g"`
		RiboflavinMgPer100g   float64        `json:"riboflavin_mg_per_100g"`
		NiacinMgPer100g       float64        `json:"niacin_mg_per_100g"`
		VitaminB6MgPer100g    float64        `json:"vitamin_b6_mg_per_100g"`
		FolateMcgPer100g      float64        `json:"folate_mcg_per_100g"`
		VitaminB12McgPer100g  float64        `json:"vitamin_b12_mcg_per_100g"`
		SourceURL             string         `json:"source_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if !hasNonEmptyString(body.SourceImageURLs) {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请至少上传一张包装图片", HTTPStatus: 400})
		return
	}
	item, err := h.nutritionSvc.CreatePackagedFood(c.Request.Context(), service.PackagedFoodInput{
		Brand:                 body.Brand,
		ProductName:           body.ProductName,
		DisplayName:           body.DisplayName,
		SearchText:            body.SearchText,
		ProductFamilyKey:      body.ProductFamilyKey,
		SpecText:              body.SpecText,
		Barcode:               body.Barcode,
		FlavorText:            body.FlavorText,
		PackageCategory:       body.PackageCategory,
		IngredientsText:       body.IngredientsText,
		SourceImageURLs:       body.SourceImageURLs,
		OCRRawText:            body.OCRRawText,
		NutritionBasisUnit:    body.NutritionBasisUnit,
		EnergyUnitRaw:         body.EnergyUnitRaw,
		RawLabelPayload:       body.RawLabelPayload,
		ConversionStatus:      body.ConversionStatus,
		ExtractConfidence:     body.ExtractConfidence,
		FieldConfidence:       body.FieldConfidence,
		IngestMethod:          body.IngestMethod,
		NetContentValue:       body.NetContentValue,
		NetContentUnit:        body.NetContentUnit,
		UnitCount:             body.UnitCount,
		UnitContentValue:      body.UnitContentValue,
		UnitContentUnit:       body.UnitContentUnit,
		ReviewStatus:          body.ReviewStatus,
		NetWeightG:            body.NetWeightG,
		ServingWeightG:        body.ServingWeightG,
		KcalPer100g:           body.KcalPer100g,
		ProteinPer100g:        body.ProteinPer100g,
		CarbsPer100g:          body.CarbsPer100g,
		FatPer100g:            body.FatPer100g,
		FiberPer100g:          body.FiberPer100g,
		SugarPer100g:          body.SugarPer100g,
		SaturatedFatPer100g:   body.SaturatedFatPer100g,
		CholesterolMgPer100g:  body.CholesterolMgPer100g,
		SodiumMgPer100g:       body.SodiumMgPer100g,
		PotassiumMgPer100g:    body.PotassiumMgPer100g,
		CalciumMgPer100g:      body.CalciumMgPer100g,
		IronMgPer100g:         body.IronMgPer100g,
		MagnesiumMgPer100g:    body.MagnesiumMgPer100g,
		ZincMgPer100g:         body.ZincMgPer100g,
		VitaminARaeMcgPer100g: body.VitaminARaeMcgPer100g,
		VitaminCMgPer100g:     body.VitaminCMgPer100g,
		VitaminDMcgPer100g:    body.VitaminDMcgPer100g,
		VitaminEMgPer100g:     body.VitaminEMgPer100g,
		VitaminKMcgPer100g:    body.VitaminKMcgPer100g,
		ThiaminMgPer100g:      body.ThiaminMgPer100g,
		RiboflavinMgPer100g:   body.RiboflavinMgPer100g,
		NiacinMgPer100g:       body.NiacinMgPer100g,
		VitaminB6MgPer100g:    body.VitaminB6MgPer100g,
		FolateMcgPer100g:      body.FolateMcgPer100g,
		VitaminB12McgPer100g:  body.VitaminB12McgPer100g,
		SourceURL:             body.SourceURL,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "packaged_food_create_ok",
		slog.String("packaged_food_id", item.ID),
		slog.Int("source_image_count", len(item.SourceImageURLs)),
		slog.String("review_status", item.ReviewStatus),
		slog.Bool("barcode_present", item.Barcode != nil && strings.TrimSpace(*item.Barcode) != ""),
		slog.Float64("net_weight_g", item.NetWeightG),
	)
	response.Success(c, gin.H{"item": item})
}

func hasNonEmptyString(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

// POST /api/packaged-food/nutrition-label/recognize
func (h *FoodRecordHandler) RecognizePackagedNutritionLabel(c *gin.Context) {
	var body struct {
		ImageURL string `json:"image_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.nutritionSvc.RecognizePackagedNutritionLabel(c.Request.Context(), body.ImageURL)
	if err != nil {
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "packaged_nutrition_label_recognize_ok",
		slog.Float64("confidence", result.Confidence),
		slog.Bool("has_product_name", strings.TrimSpace(result.ProductName) != ""),
		slog.Bool("has_brand", strings.TrimSpace(result.Brand) != ""),
	)
	response.Success(c, gin.H{"nutrition": result})
}

// POST /api/packaged-food/nutrition-label/submit
func (h *FoodRecordHandler) SubmitPackagedNutritionLabelTask(c *gin.Context) {
	var body struct {
		ImageURL string `json:"image_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logFoodRecordAPI(c, "packaged_nutrition_label_submit")
	taskID, err := h.nutritionSvc.SubmitPackagedNutritionLabelTask(c.Request.Context(), userID, body.ImageURL)
	if err != nil {
		logFoodRecordAPIError(c, "packaged_nutrition_label_submit", err)
		response.Error(c, err)
		return
	}
	bindAnalysisTaskID(c, taskID)
	logFoodRecordAPI(c, "packaged_nutrition_label_submit_ok", taskIDAttr(c))
	response.Success(c, gin.H{"task_id": taskID, "message": "营养成分表识别任务已提交"})
}

// POST /api/packaged-food/extract/submit
func (h *FoodRecordHandler) SubmitPackagedProductExtractTask(c *gin.Context) {
	var body struct {
		ImageURLs          []string `json:"image_urls"`
		SourceTaskID       string   `json:"source_task_id"`
		RecognizedNameHint string   `json:"recognized_name_hint"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logFoodRecordAPI(c, "packaged_product_extract_submit",
		slog.Int("image_count", len(body.ImageURLs)),
	)
	taskID, err := h.nutritionSvc.SubmitPackagedProductExtractTask(c.Request.Context(), userID, service.SubmitPackagedProductExtractInput{
		ImageURLs:          body.ImageURLs,
		SourceTaskID:       body.SourceTaskID,
		RecognizedNameHint: body.RecognizedNameHint,
	})
	if err != nil {
		logFoodRecordAPIError(c, "packaged_product_extract_submit", err)
		response.Error(c, err)
		return
	}
	bindAnalysisTaskID(c, taskID)
	logFoodRecordAPI(c, "packaged_product_extract_submit_ok", taskIDAttr(c))
	response.Success(c, gin.H{"task_id": taskID, "message": "预包装商品识别任务已提交"})
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
	logFoodRecordAPI(c, "critical_samples_save_ok", slog.Int("sample_count", len(body.Items)))
	response.Success(c, gin.H{"message": "已保存偏差样本", "count": len(body.Items)})
}

func filepathExt(filename string) string {
	if i := strings.LastIndex(filename, "."); i >= 0 {
		return filename[i:]
	}
	return ""
}

var sharePageLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type foodRecordSharePageData struct {
	Title       string
	Description string
	URL         string
	ImageURL    string
	MealLabel   string
	RecordDate  string
	Calories    int
	Protein     string
	Carbs       string
	Fat         string
	Foods       []foodRecordShareFoodItem
}

type foodRecordShareFoodItem struct {
	Name     string
	Intake   int
	Calories int
}

func buildFoodRecordSharePageData(c *gin.Context, record *domain.FoodRecord) foodRecordSharePageData {
	if record == nil {
		return foodRecordSharePageData{Title: "Food Link 饮食记录", Description: "来自 Food Link 的饮食记录"}
	}
	mealLabel := shareMealTypeLabel(record.MealType)
	calories := int(math.Round(record.TotalCalories))
	title := fmt.Sprintf("%s饮食记录", mealLabel)
	if calories > 0 {
		title = fmt.Sprintf("%s · %d kcal", title, calories)
	}
	foods := make([]foodRecordShareFoodItem, 0, minInt(len(record.Items), 8))
	names := make([]string, 0, minInt(len(record.Items), 4))
	for _, item := range record.Items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		if len(names) < 4 {
			names = append(names, name)
		}
		if len(foods) < 8 {
			foods = append(foods, foodRecordShareFoodItem{
				Name:     name,
				Intake:   int(math.Round(foodRecordShareItemIntake(item))),
				Calories: int(math.Round(item.Nutrients.Calories)),
			})
		}
	}
	descriptionParts := []string{}
	if record.Description != nil && strings.TrimSpace(*record.Description) != "" {
		descriptionParts = append(descriptionParts, strings.TrimSpace(*record.Description))
	} else if len(names) > 0 {
		descriptionParts = append(descriptionParts, strings.Join(names, "、"))
	}
	descriptionParts = append(descriptionParts, fmt.Sprintf("蛋白质 %s g，碳水 %s g，脂肪 %s g",
		shareFloat(record.TotalProtein),
		shareFloat(record.TotalCarbs),
		shareFloat(record.TotalFat),
	))
	description := strings.Join(descriptionParts, "。")
	recordDate := ""
	if record.RecordTime != nil {
		recordDate = record.RecordTime.In(sharePageLocation).Format("2006-01-02 15:04")
	}
	return foodRecordSharePageData{
		Title:       title,
		Description: description,
		URL:         requestPublicURL(c),
		ImageURL:    firstFoodRecordImageURL(record),
		MealLabel:   mealLabel,
		RecordDate:  recordDate,
		Calories:    calories,
		Protein:     shareFloat(record.TotalProtein),
		Carbs:       shareFloat(record.TotalCarbs),
		Fat:         shareFloat(record.TotalFat),
		Foods:       foods,
	}
}

func renderFoodRecordSharePageError(c *gin.Context, recordID string, err error) {
	status, title, message := foodRecordSharePageErrorMeta(err)
	logFoodRecordAPI(c, "share_page_failed",
		slog.String("record_id", recordID),
		slog.Int("http.status_code", status),
		slog.String("error", err.Error()),
	)
	body := fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>%s</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6fbf7;color:#17261d}
    main{max-width:560px;margin:0 auto;padding:72px 24px}
    h1{font-size:24px;line-height:1.3;margin:0 0 12px}
    p{font-size:16px;line-height:1.7;color:#52605a;margin:0}
  </style>
</head>
<body><main><h1>%s</h1><p>%s</p></main></body>
</html>`,
		template.HTMLEscapeString(title),
		template.HTMLEscapeString(title),
		template.HTMLEscapeString(message),
	)
	c.Data(status, "text/html; charset=utf-8", []byte(body))
}

func foodRecordSharePageErrorMeta(err error) (int, string, string) {
	switch {
	case errors.Is(err, commonerrors.ErrNotFound):
		return http.StatusNotFound, "记录不存在", "这条饮食记录不存在，或分享链接已经失效。"
	case errors.Is(err, commonerrors.ErrForbidden):
		return http.StatusForbidden, "记录未公开", "这条饮食记录当前不可公开查看。"
	default:
		return http.StatusInternalServerError, "暂时无法打开", "分享页暂时无法打开，请稍后再试。"
	}
}

func requestPublicURL(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	if i := strings.Index(scheme, ","); i >= 0 {
		scheme = strings.TrimSpace(scheme[:i])
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	return scheme + "://" + host + c.Request.URL.RequestURI()
}

func firstFoodRecordImageURL(record *domain.FoodRecord) string {
	if record == nil {
		return ""
	}
	for _, imageURL := range record.ImagePaths {
		if trimmed := strings.TrimSpace(imageURL); trimmed != "" {
			return trimmed
		}
	}
	if record.ImagePath != nil {
		return strings.TrimSpace(*record.ImagePath)
	}
	return ""
}

func foodRecordShareItemIntake(item domain.FoodItem) float64 {
	if item.Intake > 0 {
		return item.Intake
	}
	if item.Weight > 0 && item.Ratio > 0 {
		return item.Weight * item.Ratio / 100
	}
	return item.Weight
}

func shareMealTypeLabel(mealType string) string {
	switch strings.TrimSpace(strings.ToLower(mealType)) {
	case "breakfast":
		return "早餐"
	case "morning_snack":
		return "早加餐"
	case "lunch":
		return "午餐"
	case "afternoon_snack", "snack":
		return "午加餐"
	case "dinner":
		return "晚餐"
	case "evening_snack":
		return "晚加餐"
	default:
		return "饮食"
	}
}

func shareFloat(value float64) string {
	rounded := math.Round(value*10) / 10
	if math.Abs(rounded-math.Round(rounded)) < 0.0001 {
		return strconv.Itoa(int(math.Round(rounded)))
	}
	return strconv.FormatFloat(rounded, 'f', 1, 64)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var foodRecordSharePageTemplate = template.Must(template.New("food-record-share-page").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{.Title}}</title>
  <meta name="description" content="{{.Description}}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{{.Title}}">
  <meta property="og:description" content="{{.Description}}">
  {{if .URL}}<meta property="og:url" content="{{.URL}}">{{end}}
  {{if .ImageURL}}<meta property="og:image" content="{{.ImageURL}}">{{end}}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{.Title}}">
  <meta name="twitter:description" content="{{.Description}}">
  {{if .ImageURL}}<meta name="twitter:image" content="{{.ImageURL}}">{{end}}
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17211b; background: #f6f8f4; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f6f8f4; }
    .page { max-width: 720px; margin: 0 auto; padding: 18px 16px 28px; }
    .hero { overflow: hidden; border-radius: 8px; background: #ffffff; border: 1px solid #e5ebe3; box-shadow: 0 12px 32px rgba(23, 33, 27, 0.08); }
    .photo { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e8efe6; }
    .fallback { min-height: 210px; display: grid; place-items: center; background: #e8efe6; color: #2f7f62; font-size: 26px; font-weight: 800; }
    .content { padding: 22px; }
    .eyebrow { color: #2f7f62; font-weight: 700; font-size: 14px; }
    h1 { margin: 8px 0 8px; font-size: 28px; line-height: 1.18; letter-spacing: 0; }
    .date { color: #6b7280; font-size: 14px; margin-bottom: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
    .metric { background: #f2f7ef; border-radius: 8px; padding: 12px 8px; text-align: center; }
    .metric strong { display: block; font-size: 20px; color: #17211b; }
    .metric span { display: block; margin-top: 3px; font-size: 12px; color: #607067; }
    .desc { color: #45524a; font-size: 15px; line-height: 1.7; margin: 0 0 18px; }
    .foods { display: grid; gap: 8px; margin-top: 14px; }
    .food { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid #edf1ea; }
    .food-name { font-weight: 700; color: #17211b; overflow-wrap: anywhere; }
    .food-meta { flex: 0 0 auto; color: #607067; font-size: 14px; }
    .brand { margin-top: 18px; color: #7a857e; font-size: 13px; text-align: center; }
    @media (max-width: 520px) {
      .page { padding: 0 0 20px; }
      .hero { border-radius: 0; border-left: 0; border-right: 0; }
      .content { padding: 20px 16px; }
      h1 { font-size: 24px; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <main class="page">
    <article class="hero">
      {{if .ImageURL}}<img class="photo" src="{{.ImageURL}}" alt="{{.Title}}">{{else}}<div class="fallback">Food Link</div>{{end}}
      <section class="content">
        <div class="eyebrow">{{.MealLabel}}</div>
        <h1>{{.Title}}</h1>
        {{if .RecordDate}}<div class="date">{{.RecordDate}}</div>{{end}}
        <div class="metrics">
          <div class="metric"><strong>{{.Calories}}</strong><span>kcal</span></div>
          <div class="metric"><strong>{{.Protein}}</strong><span>蛋白质 g</span></div>
          <div class="metric"><strong>{{.Carbs}}</strong><span>碳水 g</span></div>
          <div class="metric"><strong>{{.Fat}}</strong><span>脂肪 g</span></div>
        </div>
        <p class="desc">{{.Description}}</p>
        {{if .Foods}}
        <div class="foods">
          {{range .Foods}}
          <div class="food">
            <div class="food-name">{{.Name}}</div>
            <div class="food-meta">{{if gt .Intake 0}}{{.Intake}} g · {{end}}{{if gt .Calories 0}}{{.Calories}} kcal{{end}}</div>
          </div>
          {{end}}
        </div>
        {{end}}
      </section>
    </article>
    <div class="brand">来自 Food Link</div>
  </main>
</body>
</html>`))
