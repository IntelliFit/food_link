package handler

import (
	"context"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/service"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
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
	RecommendMealType(ctx context.Context, userID string, date string, refTime *time.Time) (string, string, error)
}

type UploadService interface {
	UploadBase64(base64Image string) (string, error)
	UploadFile(fileBytes []byte, ext, contentType string) (string, error)
	UploadAnalyzeVideo(ctx context.Context, userID, videoPath string, sizeBytes int64) (*service.AnalyzeVideoUploadResult, error)
}

type FoodNutritionService interface {
	Search(ctx context.Context, query string, limit int) ([]map[string]any, error)
	GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error)
	CreatePackagedFood(ctx context.Context, input service.PackagedFoodInput) (*domain.PackagedFood, error)
	GetPackagedFood(ctx context.Context, id string) (*domain.PackagedFood, error)
	SubmitPackagedFoodCorrection(ctx context.Context, userID string, input service.SubmitPackagedFoodCorrectionInput) (*domain.PackagedFoodCorrectionSubmission, error)
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
		EatingMood       *string           `json:"eating_mood"`
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
		EatingMood:       body.EatingMood,
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

// GET /api/food-record/recommend-meal-type
func (h *FoodRecordHandler) RecommendMealType(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := c.Query("date")
	refTimeStr := c.Query("ref_time")
	var refTime *time.Time
	if refTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, refTimeStr); err == nil {
			refTime = &parsed
		}
	}
	mealType, generatedBy, err := h.recordSvc.RecommendMealType(c.Request.Context(), userID, date, refTime)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"meal_type":    mealType,
		"generated_by": generatedBy,
	})
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
		EatingMood       *string           `json:"eating_mood"`
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
		EatingMood:       body.EatingMood,
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
	applyFoodRecordShareCORS(c)
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

// OPTIONS /api/food-record/share/:record_id
func (h *FoodRecordHandler) ShareFoodRecordOptions(c *gin.Context) {
	applyFoodRecordShareCORS(c)
	c.Status(http.StatusNoContent)
}

// GET /share/food-record/:record_id
func (h *FoodRecordHandler) ShareFoodRecordPage(c *gin.Context) {
	recordID := c.Param("record_id")
	targetURL := buildFoodRecordFrontendShareURL(c, recordID)
	logFoodRecordAPI(c, "share_page_redirect",
		slog.String("record_id", strings.TrimSpace(recordID)),
		slog.String("redirect_url", targetURL),
	)
	c.Redirect(http.StatusFound, targetURL)
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

// POST /api/upload-analyze-video-file
func (h *FoodRecordHandler) UploadAnalyzeVideoFile(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxAnalyzeVideoSizeBytes+1024*1024)
	file, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频文件不能为空或超过上传限制", HTTPStatus: 400})
		return
	}
	if file.Size <= 0 {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频文件为空", HTTPStatus: 400})
		return
	}
	if file.Size > service.MaxAnalyzeVideoSizeBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频过大，最多支持 8MB", HTTPStatus: http.StatusRequestEntityTooLarge})
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(file.Header.Get("Content-Type")))
	ext := strings.ToLower(filepathExt(file.Filename))
	if !isSupportedAnalyzeVideo(contentType, ext) {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "仅支持 MP4、MOV 或 M4V 视频", HTTPStatus: 400})
		return
	}
	if ext == "" {
		ext = ".mp4"
	}

	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()
	tempFile, err := os.CreateTemp("", "foodlink-analyze-video-*"+ext)
	if err != nil {
		response.Error(c, err)
		return
	}
	tempPath := tempFile.Name()
	defer os.Remove(tempPath)

	written, copyErr := io.Copy(tempFile, io.LimitReader(opened, service.MaxAnalyzeVideoSizeBytes+1))
	closeErr := tempFile.Close()
	if copyErr != nil {
		response.Error(c, copyErr)
		return
	}
	if closeErr != nil {
		response.Error(c, closeErr)
		return
	}
	if written <= 0 || written != file.Size {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频上传不完整，请重新选择", HTTPStatus: 400})
		return
	}
	if written > service.MaxAnalyzeVideoSizeBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频过大，最多支持 8MB", HTTPStatus: http.StatusRequestEntityTooLarge})
		return
	}

	userID := c.GetString(authmw.ContextUserIDKey)
	logFoodRecordAPI(c, "upload_analyze_video_file", slog.Int64("file.size", written), slog.String("file.content_type", contentType))
	result, err := h.uploadSvc.UploadAnalyzeVideo(c.Request.Context(), userID, tempPath, written)
	if err != nil {
		logFoodRecordAPIError(c, "upload_analyze_video_file", err, slog.Int64("file.size", written))
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "upload_analyze_video_file_ok",
		slog.Int64("file.size", written),
		slog.Int("keyframe_count", len(result.Keyframes)),
		slog.Int64("video.duration_ms", result.DurationMS),
	)
	response.Success(c, result)
}

func isSupportedAnalyzeVideo(contentType, ext string) bool {
	if strings.HasPrefix(contentType, "video/") {
		return ext == "" || ext == ".mp4" || ext == ".mov" || ext == ".m4v"
	}
	switch ext {
	case ".mp4", ".mov", ".m4v":
	default:
		return false
	}
	return contentType == "" || contentType == "application/octet-stream" || contentType == "application/mp4"
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

// GET /api/packaged-food/:food_id
func (h *FoodRecordHandler) GetPackagedFood(c *gin.Context) {
	item, err := h.nutritionSvc.GetPackagedFood(c.Request.Context(), c.Param("food_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

// POST /api/packaged-food/corrections
func (h *FoodRecordHandler) SubmitPackagedFoodCorrection(c *gin.Context) {
	var rawFields map[string]any
	if err := c.ShouldBindBodyWith(&rawFields, binding.JSON); err != nil {
		response.Error(c, err)
		return
	}
	var body struct {
		PackagedFoodID        string         `json:"packaged_food_id"`
		ReasonType            string         `json:"reason_type"`
		Comment               string         `json:"comment"`
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
	}
	if err := c.ShouldBindBodyWith(&body, binding.JSON); err != nil {
		response.Error(c, err)
		return
	}
	providedFields := make(map[string]bool, len(rawFields))
	for field := range rawFields {
		switch field {
		case "packaged_food_id", "reason_type", "comment":
			continue
		default:
			providedFields[field] = true
		}
	}
	logFoodRecordAPI(c, "packaged_food_correction_submit",
		slog.String("packaged_food_id", strings.TrimSpace(body.PackagedFoodID)),
		slog.String("reason_type", strings.TrimSpace(body.ReasonType)),
		slog.Int("provided_field_count", len(providedFields)),
	)
	item, err := h.nutritionSvc.SubmitPackagedFoodCorrection(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), service.SubmitPackagedFoodCorrectionInput{
		PackagedFoodID: body.PackagedFoodID,
		ReasonType:     body.ReasonType,
		Comment:        body.Comment,
		ProvidedFields: providedFields,
		Payload: service.PackagedFoodInput{
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
		},
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logFoodRecordAPI(c, "packaged_food_correction_submit_ok",
		slog.String("submission_id", item.ID),
		slog.String("packaged_food_id", item.PackagedFoodID),
		slog.Int("changed_field_count", len(item.ProposedPatch)),
	)
	response.Success(c, gin.H{"id": item.ID, "message": "纠错提案已提交，等待审核", "item": item})
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

const foodRecordShareFrontendBaseURL = "https://healthymax.cn"

func buildFoodRecordFrontendShareURL(c *gin.Context, recordID string) string {
	target, err := url.Parse(foodRecordShareFrontendBaseURL)
	if err != nil {
		return foodRecordShareFrontendBaseURL
	}
	target.Path = "/share/food-record/" + strings.TrimSpace(recordID)
	query := target.Query()
	if apiEnv := foodRecordShareAPIEnv(c); apiEnv != "" {
		query.Set("api_env", apiEnv)
	}
	target.RawQuery = query.Encode()
	return target.String()
}

func foodRecordShareAPIEnv(c *gin.Context) string {
	host := forwardedHost(c)
	switch {
	case strings.EqualFold(host, "dev.api.healthymax.cn"):
		return "dev"
	case strings.EqualFold(host, "api.healthymax.cn"):
		return ""
	case strings.HasPrefix(host, "127.0.0.1"), strings.HasPrefix(host, "localhost"), strings.HasPrefix(host, "10.0.2.2"):
		return "local"
	default:
		return ""
	}
}

func forwardedHost(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	if i := strings.Index(host, ","); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	return strings.ToLower(host)
}

func applyFoodRecordShareCORS(c *gin.Context) {
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if !isFoodRecordShareCORSOriginAllowed(origin) {
		return
	}
	c.Header("Access-Control-Allow-Origin", origin)
	c.Header("Vary", "Origin")
	c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Accept, Content-Type, Origin")
	c.Header("Access-Control-Max-Age", "86400")
}

func isFoodRecordShareCORSOriginAllowed(origin string) bool {
	switch strings.ToLower(strings.TrimRight(strings.TrimSpace(origin), "/")) {
	case "https://healthymax.cn",
		"https://www.healthymax.cn",
		"http://localhost:5173",
		"http://127.0.0.1:5173":
		return true
	default:
		return false
	}
}
