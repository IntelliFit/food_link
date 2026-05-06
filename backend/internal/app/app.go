package app

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	authmw "food_link/backend/internal/auth"
	authhandler "food_link/backend/internal/auth/handler"
	authrepo "food_link/backend/internal/auth/repo"
	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/internal/common/routes"
	communityhandler "food_link/backend/internal/community/handler"
	communityrepo "food_link/backend/internal/community/repo"
	communityservice "food_link/backend/internal/community/service"
	friendhandler "food_link/backend/internal/friend/handler"
	friendrepo "food_link/backend/internal/friend/repo"
	friendservice "food_link/backend/internal/friend/service"
	foodrecordhandler "food_link/backend/internal/foodrecord/handler"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	foodrecordservice "food_link/backend/internal/foodrecord/service"
	healthhandler "food_link/backend/internal/health/handler"
	healthrepo "food_link/backend/internal/health/repo"
	healthservice "food_link/backend/internal/health/service"
	homehandler "food_link/backend/internal/home/handler"
	homerepo "food_link/backend/internal/home/repo"
	homeservice "food_link/backend/internal/home/service"
	analyzehandler "food_link/backend/internal/analyze/handler"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	membershiphandler "food_link/backend/internal/membership/handler"
	membershiprepo "food_link/backend/internal/membership/repo"
	membershipservice "food_link/backend/internal/membership/service"
	"food_link/backend/internal/stub"
	systemhandler "food_link/backend/internal/system/handler"
	testbackendhandler "food_link/backend/internal/testbackend/handler"
	testbackendrepo "food_link/backend/internal/testbackend/repo"
	testbackendservice "food_link/backend/internal/testbackend/service"
	userhandler "food_link/backend/internal/user/handler"
	expiryhandler "food_link/backend/internal/expiry/handler"
	expiryrepo "food_link/backend/internal/expiry/repo"
	expiryservice "food_link/backend/internal/expiry/service"
	utilityhandler "food_link/backend/internal/utility/handler"
	utilityrepo "food_link/backend/internal/utility/repo"
	utilityservice "food_link/backend/internal/utility/service"
	userrepo "food_link/backend/internal/user/repo"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	tracing "food_link/backend/pkg/trace"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type App struct {
	engine        *gin.Engine
	db            *gorm.DB
	log           *zap.Logger
	shutdownTrace func(context.Context) error
}

func New(cfg *config.Config) (*App, error) {
	log, err := logger.New(cfg.App.Env)
	if err != nil {
		return nil, err
	}
	logger.SetGlobal(log)
	if cfg.App.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		return nil, err
	}
	traceShutdown, err := tracing.Init(cfg.OTel, cfg.App.Name)
	if err != nil {
		return nil, err
	}

	engine := gin.New()
	engine.Use(gin.Logger())
	engine.Use(gin.Recovery())
	if cfg.OTel.Enabled {
		engine.Use(otelgin.Middleware(cfg.App.Name))
	}

	storageClient := storage.New(cfg.Storage)

	jwtSvc := authservice.NewJWTService(cfg.JWT.Secret, cfg.JWT.AccessTokenTTLSeconds, cfg.JWT.RefreshTokenTTLSeconds)
	userRepo := authrepo.NewUserRepo(db)
	loginSvc := authservice.NewLoginService(cfg, userRepo, jwtSvc)
	loginHandler := authhandler.NewLoginHandler(loginSvc)

	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchLogRepo := userrepo.NewModeSwitchLogRepo(db)
	analysisTaskRepo := userrepo.NewAnalysisTaskRepo(db)

	userSvc := userservice.NewUserService(userRepo, healthDocRepo, modeSwitchLogRepo)
	bindPhoneSvc := userservice.NewBindPhoneService(cfg, userRepo)
	uploadSvc := userservice.NewUploadService(storageClient)
	ocrSvc := userservice.NewOCRService(cfg)
	analysisTaskSvc := userservice.NewAnalysisTaskService(analysisTaskRepo)

	userHandler := userhandler.NewUserHandler(userSvc, bindPhoneSvc, uploadSvc, ocrSvc, analysisTaskSvc)

	// Analyze module DI
	analyzeTaskRepo := analyzerepo.NewTaskRepo(db)
	analyzePrecisionRepo := analyzerepo.NewPrecisionRepo(db)
	dashScopeClient := analyzeservice.NewDashScopeClient(cfg.External.DashscopeAPIKey, "gemini-3-flash-preview")
	ofoxAIClient := analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, "gemini-3-flash-preview")
	analyzeSvc := analyzeservice.NewAnalyzeService(dashScopeClient, ofoxAIClient, userRepo)
	analyzeTaskSvc := analyzeservice.NewTaskService(analyzeTaskRepo, analyzePrecisionRepo, userRepo)
	adminKey := os.Getenv("ADMIN_API_KEY")
	analyzeHandler := analyzehandler.NewAnalyzeHandler(analyzeSvc, analyzeTaskSvc, adminKey)

	// FoodRecord module DI
	frRepo := foodrecordrepo.NewFoodRecordRepo(db)
	frTaskRepo := foodrecordrepo.NewAnalysisTaskRepo(db)
	frNutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	frSvc := foodrecordservice.NewFoodRecordService(frRepo, frTaskRepo, userRepo)
	frUploadSvc := foodrecordservice.NewUploadService(storageClient)
	frNutritionSvc := foodrecordservice.NewFoodNutritionService(frNutritionRepo)
	frHandler := foodrecordhandler.NewFoodRecordHandler(frSvc, frUploadSvc, frNutritionSvc)

	homeRepo := homerepo.NewHomeRepo(db)
	dashboardService := homeservice.NewDashboardService(userRepo, homeRepo)
	dashboardHandler := homehandler.NewDashboardHandler(dashboardService)
	// Friend module DI
	friendRepo := friendrepo.NewFriendRepo(db)
	friendSvc := friendservice.NewFriendService(friendRepo, userRepo)
	friendHandler := friendhandler.NewFriendHandler(friendSvc)

	// Community module DI
	feedRepo := communityrepo.NewFeedRepo(db)
	notifRepo := communityrepo.NewNotificationRepo(db)
	communitySvc := communityservice.NewCommunityService(feedRepo, notifRepo, userRepo)
	communityHandler := communityhandler.NewCommunityHandler(communitySvc)

	// Health module DI
	bodyMetricsRepo := healthrepo.NewBodyMetricsRepo(db)
	exerciseRepo := healthrepo.NewExerciseRepo(db)
	statsRepo := healthrepo.NewStatsRepo(db)
	bodyMetricsSvc := healthservice.NewBodyMetricsService(bodyMetricsRepo)
	exerciseSvc := healthservice.NewExerciseService(exerciseRepo)
	statsSvc := healthservice.NewStatsService(statsRepo, bodyMetricsSvc)
	healthHandler := healthhandler.NewHealthHandler(bodyMetricsSvc, exerciseSvc, statsSvc)

	// Membership module DI
	membershipRepo := membershiprepo.NewMembershipRepo(db)
	membershipSvc := membershipservice.NewMembershipService(membershipRepo)
	membershipHandler := membershiphandler.NewMembershipHandler(membershipSvc)

	// Expiry module DI
	expiryRepo := expiryrepo.NewExpiryRepo(db)
	expiryTaskRepo := expiryrepo.NewTaskRepo(db)
	expirySvc := expiryservice.NewExpiryService(expiryRepo, expiryTaskRepo)
	expiryHandler := expiryhandler.NewExpiryHandler(expirySvc)

	// Utility module DI
	locationSvc := utilityservice.NewLocationService(cfg)
	qrcodeSvc := utilityservice.NewQRCodeService()
	manualFoodRepo := utilityrepo.NewManualFoodRepo(db)
	manualFoodSvc := utilityservice.NewManualFoodService(manualFoodRepo)
	utilityHandler := utilityhandler.NewUtilityHandler(locationSvc, qrcodeSvc, manualFoodSvc)

	// TestBackend module DI
	testBackendPromptRepo := testbackendrepo.NewPromptRepo(db)
	testBackendBatchRepo := testbackendrepo.NewBatchRepo(db)
	testBackendDatasetRepo := testbackendrepo.NewDatasetRepo(db)
	testBackendSvc := testbackendservice.NewTestBackendService(testBackendPromptRepo, testBackendBatchRepo, testBackendDatasetRepo, dashScopeClient, ofoxAIClient)
	testBackendHandler := testbackendhandler.NewTestBackendHandler(testBackendSvc)

	commentHandler := communityhandler.NewCommentHandler(homeRepo, userRepo)
	system := systemhandler.New()

	app := &App{
		engine:        engine,
		db:            db,
		log:           log,
		shutdownTrace: traceShutdown,
	}

	engine.POST("/api/login", loginHandler.Login)
	engine.GET("/api", system.Root)
	engine.GET("/api/health", system.Health)
	engine.GET("/map-picker", system.MapPicker)
	engine.GET("/test-backend", system.TestBackendPage)
	engine.GET("/test-backend/login", system.TestBackendLoginPage)
	engine.GET("/ws/stats/insight", websocketStub())

	// User routes
	engine.GET("/api/user/profile", authmw.RequireJWT(jwtSvc), userHandler.GetProfile)
	engine.PUT("/api/user/profile", authmw.RequireJWT(jwtSvc), userHandler.UpdateProfile)
	engine.POST("/api/user/bind-phone", authmw.RequireJWT(jwtSvc), userHandler.BindPhone)
	engine.POST("/api/user/upload-avatar", authmw.RequireJWT(jwtSvc), userHandler.UploadAvatar)
	engine.GET("/api/user/dashboard-targets", authmw.RequireJWT(jwtSvc), userHandler.GetDashboardTargets)
	engine.PUT("/api/user/dashboard-targets", authmw.RequireJWT(jwtSvc), userHandler.UpdateDashboardTargets)
	engine.GET("/api/user/health-profile", authmw.RequireJWT(jwtSvc), userHandler.GetHealthProfile)
	engine.PUT("/api/user/health-profile", authmw.RequireJWT(jwtSvc), userHandler.UpdateHealthProfile)
	engine.POST("/api/user/health-profile/ocr", authmw.RequireJWT(jwtSvc), userHandler.HealthReportOCR)
	engine.POST("/api/user/health-profile/ocr-extract", authmw.RequireJWT(jwtSvc), userHandler.HealthReportOCRExtract)
	engine.POST("/api/user/health-profile/submit-report-extraction-task", authmw.RequireJWT(jwtSvc), userHandler.SubmitReportExtractionTask)
	engine.POST("/api/user/health-profile/upload-report-image", authmw.RequireJWT(jwtSvc), userHandler.UploadReportImage)
	engine.GET("/api/user/record-days", authmw.RequireJWT(jwtSvc), userHandler.GetRecordDays)
	engine.POST("/api/user/last-seen-analyze-history", authmw.RequireJWT(jwtSvc), userHandler.UpdateLastSeenAnalyzeHistory)

	engine.GET("/api/home/dashboard", authmw.RequireJWT(jwtSvc), dashboardHandler.HomeDashboard)
	engine.GET("/api/food-record/:record_id/poster-calorie-compare", authmw.RequireJWT(jwtSvc), dashboardHandler.PosterCalorieCompare)
	engine.DELETE("/api/community/feed/:record_id/comments/:comment_id", authmw.RequireJWT(jwtSvc), commentHandler.DeleteComment)

	// Analyze routes
	engine.POST("/api/analyze", authmw.OptionalJWT(jwtSvc), analyzeHandler.Analyze)
	engine.POST("/api/analyze-text", authmw.OptionalJWT(jwtSvc), analyzeHandler.AnalyzeText)
	engine.POST("/api/analyze-compare", authmw.OptionalJWT(jwtSvc), analyzeHandler.AnalyzeCompare)
	engine.POST("/api/analyze-compare-engines", authmw.OptionalJWT(jwtSvc), analyzeHandler.AnalyzeCompareEngines)
	engine.POST("/api/analyze/batch", authmw.RequireJWT(jwtSvc), analyzeHandler.AnalyzeBatch)
	engine.POST("/api/analyze/submit", authmw.RequireJWT(jwtSvc), analyzeHandler.SubmitAnalyzeTask)
	engine.POST("/api/analyze-text/submit", authmw.RequireJWT(jwtSvc), analyzeHandler.SubmitTextTask)
	engine.GET("/api/analyze/tasks", authmw.RequireJWT(jwtSvc), analyzeHandler.ListTasks)
	engine.GET("/api/analyze/tasks/count", authmw.RequireJWT(jwtSvc), analyzeHandler.CountTasks)
	engine.GET("/api/analyze/tasks/status-count", authmw.RequireJWT(jwtSvc), analyzeHandler.CountTasksByStatus)
	engine.GET("/api/analyze/tasks/:task_id", authmw.RequireJWT(jwtSvc), analyzeHandler.GetTask)
	engine.PATCH("/api/analyze/tasks/:task_id/result", authmw.RequireJWT(jwtSvc), analyzeHandler.UpdateTaskResult)
	engine.DELETE("/api/analyze/tasks/:task_id", authmw.RequireJWT(jwtSvc), analyzeHandler.DeleteTask)
	engine.POST("/api/analyze/tasks/cleanup-timeout", analyzeHandler.CleanupTimeoutTasks)

	// FoodRecord routes
	engine.POST("/api/food-record/save", authmw.RequireJWT(jwtSvc), frHandler.SaveFoodRecord)
	engine.GET("/api/food-record/list", authmw.RequireJWT(jwtSvc), frHandler.ListFoodRecords)
	engine.GET("/api/food-record/share/:record_id", frHandler.ShareFoodRecord)
	engine.GET("/api/food-record/:record_id", authmw.RequireJWT(jwtSvc), frHandler.GetFoodRecord)
	engine.PUT("/api/food-record/:record_id", authmw.RequireJWT(jwtSvc), frHandler.UpdateFoodRecord)
	engine.DELETE("/api/food-record/:record_id", authmw.RequireJWT(jwtSvc), frHandler.DeleteFoodRecord)
	engine.POST("/api/upload-analyze-image", frHandler.UploadAnalyzeImage)
	engine.POST("/api/upload-analyze-image-file", frHandler.UploadAnalyzeImageFile)
	engine.GET("/api/food-nutrition/search", authmw.RequireJWT(jwtSvc), frHandler.SearchFoodNutrition)
	engine.GET("/api/food-nutrition/unresolved/top", authmw.RequireJWT(jwtSvc), frHandler.GetUnresolvedTop)
	engine.POST("/api/critical-samples", authmw.RequireJWT(jwtSvc), frHandler.SaveCriticalSamples)

	// Friend routes
	engine.GET("/api/friend/search", authmw.RequireJWT(jwtSvc), friendHandler.Search)
	engine.POST("/api/friend/request", authmw.RequireJWT(jwtSvc), friendHandler.SendRequest)
	engine.GET("/api/friend/requests", authmw.RequireJWT(jwtSvc), friendHandler.GetRequests)
	engine.POST("/api/friend/request/:request_id/respond", authmw.RequireJWT(jwtSvc), friendHandler.RespondRequest)
	engine.DELETE("/api/friend/request/:request_id", authmw.RequireJWT(jwtSvc), friendHandler.CancelRequest)
	engine.GET("/api/friend/list", authmw.RequireJWT(jwtSvc), friendHandler.List)
	engine.GET("/api/friend/count", authmw.RequireJWT(jwtSvc), friendHandler.Count)
	engine.DELETE("/api/friend/:friend_id", authmw.RequireJWT(jwtSvc), friendHandler.DeleteFriend)
	engine.GET("/api/friend/requests/all", authmw.RequireJWT(jwtSvc), friendHandler.RequestsOverview)
	engine.POST("/api/friend/cleanup-duplicates", authmw.RequireJWT(jwtSvc), friendHandler.CleanupDuplicates)
	engine.GET("/api/friend/invite/profile/:user_id", friendHandler.InviteProfile)
	engine.GET("/api/friend/invite/profile-by-code", friendHandler.InviteProfileByCode)
	engine.GET("/api/friend/invite/resolve", authmw.RequireJWT(jwtSvc), friendHandler.InviteResolve)
	engine.POST("/api/friend/invite/accept", authmw.RequireJWT(jwtSvc), friendHandler.InviteAccept)

	// Community routes
	engine.GET("/api/community/public-feed", communityHandler.PublicFeed)
	engine.GET("/api/community/feed", authmw.RequireJWT(jwtSvc), communityHandler.Feed)
	engine.GET("/api/community/checkin-leaderboard", authmw.RequireJWT(jwtSvc), communityHandler.CheckinLeaderboard)
	engine.POST("/api/community/feed/:record_id/like", authmw.RequireJWT(jwtSvc), communityHandler.LikeFeed)
	engine.DELETE("/api/community/feed/:record_id/like", authmw.RequireJWT(jwtSvc), communityHandler.UnlikeFeed)
	engine.POST("/api/community/feed/:record_id/hide", authmw.RequireJWT(jwtSvc), communityHandler.HideFeed)
	engine.GET("/api/community/feed/:record_id/comments", authmw.RequireJWT(jwtSvc), communityHandler.ListComments)
	engine.GET("/api/community/feed/:record_id/context", authmw.RequireJWT(jwtSvc), communityHandler.FeedContext)
	engine.POST("/api/community/feed/:record_id/comments", authmw.RequireJWT(jwtSvc), communityHandler.PostComment)
	engine.GET("/api/community/comment-tasks", authmw.RequireJWT(jwtSvc), communityHandler.ListCommentTasks)
	engine.GET("/api/community/notifications", authmw.RequireJWT(jwtSvc), communityHandler.ListNotifications)
	engine.POST("/api/community/notifications/read", authmw.RequireJWT(jwtSvc), communityHandler.MarkNotificationsRead)

	// Health routes
	engine.GET("/api/body-metrics/summary", authmw.RequireJWT(jwtSvc), healthHandler.GetBodyMetricsSummary)
	engine.POST("/api/body-metrics/sync-local", authmw.RequireJWT(jwtSvc), healthHandler.SyncLocalBodyMetrics)
	engine.POST("/api/body-metrics/water", authmw.RequireJWT(jwtSvc), healthHandler.SaveBodyWaterLog)
	engine.POST("/api/body-metrics/water/reset", authmw.RequireJWT(jwtSvc), healthHandler.ResetBodyWaterLogs)
	engine.POST("/api/body-metrics/weight", authmw.RequireJWT(jwtSvc), healthHandler.SaveBodyWeightRecord)
	engine.GET("/api/stats/summary", authmw.RequireJWT(jwtSvc), healthHandler.GetStatsSummary)
	engine.POST("/api/stats/insight/generate", authmw.RequireJWT(jwtSvc), healthHandler.GenerateStatsInsight)
	engine.POST("/api/stats/insight/save", authmw.RequireJWT(jwtSvc), healthHandler.SaveStatsInsight)
	engine.GET("/api/exercise-calories/daily", authmw.RequireJWT(jwtSvc), healthHandler.GetExerciseCaloriesDaily)
	engine.GET("/api/exercise-logs", authmw.RequireJWT(jwtSvc), healthHandler.GetExerciseLogs)
	engine.POST("/api/exercise-logs", authmw.RequireJWT(jwtSvc), healthHandler.CreateExerciseLog)
	engine.POST("/api/exercise-logs/estimate-calories", authmw.RequireJWT(jwtSvc), healthHandler.EstimateExerciseCalories)
	engine.DELETE("/api/exercise-logs/:log_id", authmw.RequireJWT(jwtSvc), healthHandler.DeleteExerciseLog)

	// Membership routes
	engine.GET("/api/membership/plans", membershipHandler.ListPlans)
	engine.GET("/api/membership/me", authmw.RequireJWT(jwtSvc), membershipHandler.GetMyMembership)
	engine.POST("/api/membership/pay/create", authmw.RequireJWT(jwtSvc), membershipHandler.CreatePayment)
	engine.POST("/api/payment/wechat/notify/membership", membershipHandler.WechatNotify)
	engine.POST("/api/membership/rewards/share-poster/claim", authmw.RequireJWT(jwtSvc), membershipHandler.ClaimSharePosterReward)

	// Expiry routes
	engine.GET("/api/expiry/dashboard", authmw.RequireJWT(jwtSvc), expiryHandler.Dashboard)
	engine.GET("/api/expiry/items", authmw.RequireJWT(jwtSvc), expiryHandler.ListItems)
	engine.POST("/api/expiry/items", authmw.RequireJWT(jwtSvc), expiryHandler.CreateItem)
	engine.GET("/api/expiry/items/:item_id", authmw.RequireJWT(jwtSvc), expiryHandler.GetItem)
	engine.PUT("/api/expiry/items/:item_id", authmw.RequireJWT(jwtSvc), expiryHandler.UpdateItem)
	engine.POST("/api/expiry/items/:item_id/status", authmw.RequireJWT(jwtSvc), expiryHandler.UpdateStatus)
	engine.POST("/api/expiry/items/:item_id/subscribe", authmw.RequireJWT(jwtSvc), expiryHandler.Subscribe)
	engine.POST("/api/expiry/recognize", authmw.RequireJWT(jwtSvc), expiryHandler.Recognize)

	// Utility routes
	engine.POST("/api/location/reverse", utilityHandler.LocationReverse)
	engine.POST("/api/location/search", utilityHandler.LocationSearch)
	engine.POST("/api/qrcode", utilityHandler.QRCode)
	engine.GET("/api/manual-food/browse", authmw.OptionalJWT(jwtSvc), utilityHandler.ManualFoodBrowse)
	engine.GET("/api/manual-food/search", authmw.OptionalJWT(jwtSvc), utilityHandler.ManualFoodSearch)

	// TestBackend routes
	engine.GET("/api/prompts", authmw.RequireTestBackendCookie(), testBackendHandler.ListPrompts)
	engine.POST("/api/prompts", authmw.RequireTestBackendCookie(), testBackendHandler.CreatePrompt)
	engine.GET("/api/prompts/active/:model_type", authmw.RequireTestBackendCookie(), testBackendHandler.GetActivePrompt)
	engine.DELETE("/api/prompts/:prompt_id", authmw.RequireTestBackendCookie(), testBackendHandler.DeletePrompt)
	engine.GET("/api/prompts/:prompt_id", authmw.RequireTestBackendCookie(), testBackendHandler.GetPrompt)
	engine.PUT("/api/prompts/:prompt_id", authmw.RequireTestBackendCookie(), testBackendHandler.UpdatePrompt)
	engine.POST("/api/prompts/:prompt_id/activate", authmw.RequireTestBackendCookie(), testBackendHandler.ActivatePrompt)
	engine.GET("/api/prompts/:prompt_id/history", authmw.RequireTestBackendCookie(), testBackendHandler.GetPromptHistory)
	engine.POST("/api/test-backend/analyze", authmw.RequireTestBackendCookie(), testBackendHandler.Analyze)
	engine.POST("/api/test-backend/batch/prepare", authmw.RequireTestBackendCookie(), testBackendHandler.PrepareBatch)
	engine.POST("/api/test-backend/batch/start", authmw.RequireTestBackendCookie(), testBackendHandler.StartBatch)
	engine.GET("/api/test-backend/batch/:batch_id", authmw.RequireTestBackendCookie(), testBackendHandler.GetBatch)
	engine.GET("/api/test-backend/datasets", authmw.RequireTestBackendCookie(), testBackendHandler.ListDatasets)
	engine.POST("/api/test-backend/datasets/import-local", authmw.RequireTestBackendCookie(), testBackendHandler.ImportLocalDataset)
	engine.POST("/api/test-backend/datasets/:dataset_id/prepare", authmw.RequireTestBackendCookie(), testBackendHandler.PrepareDataset)
	engine.POST("/api/test-backend/login", testBackendHandler.Login)
	engine.POST("/api/test-backend/logout", testBackendHandler.Logout)
	engine.POST("/api/test/batch-upload", authmw.RequireTestBackendCookie(), testBackendHandler.LegacyBatchUpload)
	engine.POST("/api/test/single-image", authmw.RequireTestBackendCookie(), testBackendHandler.LegacySingleImage)

	routeMapPath := filepath.Join(".", "docs", "backend-api-prd", "ROUTE_MAP.md")
	if _, err := os.Stat(routeMapPath); err == nil {
		specs, loadErr := routes.LoadFromRouteMap(routeMapPath)
		if loadErr != nil {
			return nil, loadErr
		}
		registerSpecs(engine, specs, jwtSvc)
	} else {
		log.Warn("route map missing, skipped stub registration", zap.String("path", routeMapPath))
	}

	return app, nil
}

func (a *App) Engine() *gin.Engine {
	return a.engine
}

func (a *App) Close(ctx context.Context) error {
	if a.shutdownTrace != nil {
		if err := a.shutdownTrace(ctx); err != nil {
			return err
		}
	}
	if a.db != nil {
		sqlDB, err := a.db.DB()
		if err == nil {
			return sqlDB.Close()
		}
	}
	return nil
}

func registerSpecs(engine *gin.Engine, specs []routes.Spec, jwtSvc *authservice.JWTService) {
	seen := existingRoutes(engine)
	for _, spec := range specs {
		method := spec.Method
		if method == "WEBSOCKET" {
			method = http.MethodGet
		}
		key := fmt.Sprintf("%s %s", method, spec.GinPath())
		if seen[key] {
			continue
		}
		handler := stub.Handler(spec)
		switch spec.Auth {
		case "jwt_required":
			handler = wrap(authmw.RequireJWT(jwtSvc), handler)
		case "jwt_optional":
			handler = wrap(authmw.OptionalJWT(jwtSvc), handler)
		case "test_backend_cookie":
			handler = wrap(authmw.RequireTestBackendCookie(), handler)
		}
		register(engine, method, spec.GinPath(), handler)
		seen[key] = true
	}
}

func existingRoutes(engine *gin.Engine) map[string]bool {
	out := map[string]bool{}
	for _, route := range engine.Routes() {
		out[fmt.Sprintf("%s %s", route.Method, route.Path)] = true
	}
	return out
}

func register(engine *gin.Engine, method, path string, handler gin.HandlerFunc) {
	switch strings.ToUpper(method) {
	case http.MethodGet:
		engine.GET(path, handler)
	case http.MethodPost:
		engine.POST(path, handler)
	case http.MethodPut:
		engine.PUT(path, handler)
	case http.MethodPatch:
		engine.PATCH(path, handler)
	case http.MethodDelete:
		engine.DELETE(path, handler)
	}
}

func wrap(mw gin.HandlerFunc, final gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		aborted := false
		probe := func(ctx *gin.Context) {
			mw(ctx)
			aborted = ctx.IsAborted()
		}
		probe(c)
		if aborted {
			return
		}
		final(c)
	}
}

func websocketStub() gin.HandlerFunc {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	return func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.WriteJSON(gin.H{
			"code":    10004,
			"message": "websocket route registered but not migrated yet",
		})
	}
}
