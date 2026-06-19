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
	"log/slog"
)

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
		TotalWeightGrams int               `json:"total_weight_grams"`
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
		TotalWeightGrams: body.TotalWeightGrams,
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
		TotalWeightGrams *int              `json:"total_weight_grams"`
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
		TotalWeightGrams: body.TotalWeightGrams,
		Description:      body.Description,
		ImagePath:        body.ImagePath,
		ImagePaths:       body.ImagePaths,
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
	response.Success(c, gin.H{"message": "已保存偏差样本", "count": len(body.Items)})
}

func filepathExt(filename string) string {
	if i := strings.LastIndex(filename, "."); i >= 0 {
		return filename[i:]
	}
	return ""
}

