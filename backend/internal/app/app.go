package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	analyzehandler "food_link/backend/internal/analyze/handler"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authmw "food_link/backend/internal/auth"
	authhandler "food_link/backend/internal/auth/handler"
	authrepo "food_link/backend/internal/auth/repo"
	authservice "food_link/backend/internal/auth/service"
	commonmw "food_link/backend/internal/common/middleware"
	"food_link/backend/internal/common/routes"
	communityhandler "food_link/backend/internal/community/handler"
	communityrepo "food_link/backend/internal/community/repo"
	communityservice "food_link/backend/internal/community/service"
	expiryhandler "food_link/backend/internal/expiry/handler"
	expiryrepo "food_link/backend/internal/expiry/repo"
	expiryservice "food_link/backend/internal/expiry/service"
	foodrecordhandler "food_link/backend/internal/foodrecord/handler"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	foodrecordservice "food_link/backend/internal/foodrecord/service"
	friendhandler "food_link/backend/internal/friend/handler"
	friendrepo "food_link/backend/internal/friend/repo"
	friendservice "food_link/backend/internal/friend/service"
	healthhandler "food_link/backend/internal/health/handler"
	healthrepo "food_link/backend/internal/health/repo"
	healthservice "food_link/backend/internal/health/service"
	homehandler "food_link/backend/internal/home/handler"
	homerepo "food_link/backend/internal/home/repo"
	homeservice "food_link/backend/internal/home/service"
	membershiphandler "food_link/backend/internal/membership/handler"
	membershiprepo "food_link/backend/internal/membership/repo"
	membershipservice "food_link/backend/internal/membership/service"
	"food_link/backend/internal/migration"
	pethandler "food_link/backend/internal/pet/handler"
	petrepo "food_link/backend/internal/pet/repo"
	petservice "food_link/backend/internal/pet/service"
	publicfoodhandler "food_link/backend/internal/publicfood/handler"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	publicfoodservice "food_link/backend/internal/publicfood/service"
	recipehandler "food_link/backend/internal/recipe/handler"
	reciperepo "food_link/backend/internal/recipe/repo"
	recipeservice "food_link/backend/internal/recipe/service"
	"food_link/backend/internal/stub"
	systemhandler "food_link/backend/internal/system/handler"
	"food_link/backend/internal/taskqueue"
	testbackendhandler "food_link/backend/internal/testbackend/handler"
	testbackendrepo "food_link/backend/internal/testbackend/repo"
	testbackendservice "food_link/backend/internal/testbackend/service"
	userhandler "food_link/backend/internal/user/handler"
	userrepo "food_link/backend/internal/user/repo"
	userservice "food_link/backend/internal/user/service"
	utilityhandler "food_link/backend/internal/utility/handler"
	utilityrepo "food_link/backend/internal/utility/repo"
	utilityservice "food_link/backend/internal/utility/service"
	workerpkg "food_link/backend/internal/worker"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	"food_link/backend/pkg/storage"
	tracing "food_link/backend/pkg/trace"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"gorm.io/gorm"
)

type App struct {
	engine        *gin.Engine
	db            *gorm.DB
	log           *logger.Logger
	shutdownTrace func(context.Context) error
	shutdownLog   logger.ShutdownFunc
	workerCancel  context.CancelFunc
	workerDone    chan struct{}
	taskQueue     taskqueue.Queue
}

func New(cfg *config.Config) (*App, error) {
	logShutdown, err := logger.Init(context.Background(), cfg.App, cfg.Log, cfg.OTel)
	if err != nil {
		return nil, err
	}
	log := logger.L()
	if cfg.App.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	traceShutdown, err := tracing.Init(cfg.OTel, cfg.App.Name, cfg.App.Env)
	if err != nil {
		return nil, err
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		return nil, err
	}
	if err := migration.AutoMigrate(context.Background(), db, cfg.Database.Schema); err != nil {
		return nil, fmt.Errorf("auto migrate: %w", err)
	}

	engine := gin.New()
	engine.Use(logger.RequestLogger())
	engine.Use(metrics.GinMiddleware())
	engine.Use(gin.Recovery())
	if cfg.OTel.Enabled {
		engine.Use(otelgin.Middleware(cfg.App.Name, otelgin.WithFilter(shouldTraceHTTPRequest)))
	}
	engine.Use(commonmw.RequestID())

	storageClient := storage.New(cfg.Storage)
	taskQueue, err := taskqueue.New(cfg.TaskQueue, log)
	if err != nil {
		return nil, err
	}

	jwtSvc := authservice.NewJWTService(cfg.JWT.Secret, cfg.JWT.AccessTokenTTLSeconds, cfg.JWT.RefreshTokenTTLSeconds)
	userRepo := authrepo.NewUserRepo(db)
	loginSvc := authservice.NewLoginService(cfg, userRepo, jwtSvc)
	loginHandler := authhandler.NewLoginHandler(loginSvc)

	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchLogRepo := userrepo.NewModeSwitchLogRepo(db)
	analysisTaskRepo := userrepo.NewAnalysisTaskRepo(db)

	userSvc := userservice.NewUserService(userRepo, healthDocRepo, modeSwitchLogRepo, storageClient)
	bindPhoneSvc := userservice.NewBindPhoneService(cfg, userRepo)
	uploadSvc := userservice.NewUploadService(storageClient)
	ocrSvc := userservice.NewOCRService(cfg, storageClient)
	analysisTaskSvc := userservice.NewAnalysisTaskService(analysisTaskRepo, userRepo, storageClient)
	analysisTaskSvc.ConfigureTaskPublisher(taskQueue)

	userHandler := userhandler.NewUserHandler(userSvc, bindPhoneSvc, uploadSvc, ocrSvc, analysisTaskSvc)

	// Analyze module DI
	analyzeTaskRepo := analyzerepo.NewTaskRepo(db)
	analyzePrecisionRepo := analyzerepo.NewPrecisionRepo(db)
	analyzeNutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	doubaoClient := analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, "", cfg.External.DoubaoBaseURL)
	ofoxAIClient := analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, "gemini-3-flash-preview", cfg.External.OfoxAIBaseURL)
	analyzeSvc := analyzeservice.NewAnalyzeService(doubaoClient, ofoxAIClient, userRepo, analyzeNutritionRepo)
	analyzeSvc.ConfigureDoubaoClient(cfg.External.DoubaoAPIKey, cfg.External.DoubaoBaseURL, "")
	analyzeSvc.ConfigureDashScopeClient(cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL)
	analyzeSvc.ConfigureGemini31LiteClient(cfg.External.OfoxAIAPIKey, cfg.External.OfoxAIBaseURL, "gemini-3.1-flash-lite")
	analyzeSvc.ConfigureGemini35Client(cfg.External.Gemini35APIKey, cfg.External.Gemini35BaseURL, cfg.External.Gemini35Model)
	if cfg.External.DoubaoWebSearchAPIKey != "" {
		analyzeSvc.ConfigureDoubaoWebSearchClient(cfg.External.DoubaoWebSearchAPIKey, cfg.External.DoubaoBaseURL, "")
	}
	analyzeSvc.ConfigureImageProvider(cfg.External.LLMProvider)
	analyzeSvc.ConfigureDeepSeekFallback(cfg.External.DeepSeekAPIKey)
	analyzeSvc.ConfigureStorage(storageClient)
	frRepo := foodrecordrepo.NewFoodRecordRepo(db)

	analyzeTaskSvc := analyzeservice.NewTaskService(analyzeTaskRepo, analyzePrecisionRepo, userRepo, storageClient)
	analyzeTaskSvc.ConfigureTaskPublisher(taskQueue)
	analyzeTaskSvc.ConfigureRecordRepo(frRepo)

	adminKey := os.Getenv("ADMIN_API_KEY")
	analyzeHandler := analyzehandler.NewAnalyzeHandler(analyzeSvc, analyzeTaskSvc, adminKey)

	// FoodRecord module DI
	frTaskRepo := foodrecordrepo.NewAnalysisTaskRepo(db)
	frNutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	bodyMetricsRepo := healthrepo.NewBodyMetricsRepo(db)
	frSvc := foodrecordservice.NewFoodRecordService(frRepo, frTaskRepo, userRepo, storageClient)
	frSvc.ConfigureWaterLogRecorder(bodyMetricsRepo)
	frUploadSvc := foodrecordservice.NewUploadService(storageClient)
	frNutritionSvc := foodrecordservice.NewFoodNutritionService(frNutritionRepo)
	frNutritionSvc.ConfigureNutritionLabelVisionClient(doubaoClient)
	frNutritionSvc.ConfigureAsyncTasks(analyzeTaskRepo, taskQueue)
	frHandler := foodrecordhandler.NewFoodRecordHandler(frSvc, frUploadSvc, frNutritionSvc)

	homeRepo := homerepo.NewHomeRepo(db)
	dashboardService := homeservice.NewDashboardService(userRepo, homeRepo, storageClient)
	dashboardHandler := homehandler.NewDashboardHandler(dashboardService)
	// Friend module DI
	friendRepo := friendrepo.NewFriendRepo(db)
	friendSvc := friendservice.NewFriendService(friendRepo, userRepo, storageClient)
	friendHandler := friendhandler.NewFriendHandler(friendSvc)

	// Community module DI
	feedRepo := communityrepo.NewFeedRepo(db)
	notifRepo := communityrepo.NewNotificationRepo(db)
	communitySvc := communityservice.NewCommunityService(feedRepo, notifRepo, userRepo, storageClient)
	communityHandler := communityhandler.NewCommunityHandler(communitySvc)

	// Health module DI
	exerciseRepo := healthrepo.NewExerciseRepo(db)
	statsRepo := healthrepo.NewStatsRepo(db)
	bodyMetricsSvc := healthservice.NewBodyMetricsService(bodyMetricsRepo)
	exerciseSvc := healthservice.NewExerciseService(exerciseRepo, cfg)
	exerciseSvc.ConfigureTaskPublisher(taskQueue)
	exerciseSvc.ConfigureStorage(storageClient)
	statsSvc := healthservice.NewStatsService(statsRepo, bodyMetricsSvc, cfg)
	healthHandler := healthhandler.NewHealthHandler(bodyMetricsSvc, exerciseSvc, statsSvc)

	// Membership module DI
	membershipRepo := membershiprepo.NewMembershipRepo(db)
	membershipSvc := membershipservice.NewMembershipService(membershipRepo, cfg)
	statsSvc.ConfigureCreditGuard(membershipSvc)
	analyzeTaskSvc.ConfigureCreditGuard(membershipSvc)
	exerciseSvc.ConfigureCreditGuard(membershipSvc)
	exerciseSvc.ConfigureInviteRewardActivator(membershipSvc)
	frSvc.ConfigureInviteRewardActivator(membershipSvc)
	frNutritionSvc.ConfigureRewardAwarder(membershipSvc)
	membershipHandler := membershiphandler.NewMembershipHandler(membershipSvc)

	// Pet companion module DI
	petRepo := petrepo.NewPetRepo(db)
	petSvc := petservice.NewService(petRepo)
	petHandler := pethandler.NewPetHandler(petSvc)

	// Public food library module DI
	publicFoodRepo := publicfoodrepo.NewPublicFoodRepo(db)
	publicFoodSvc := publicfoodservice.NewPublicFoodService(publicFoodRepo, storageClient)
	publicFoodSvc.ConfigureTaskPublisher(taskQueue)
	publicFoodSvc.ConfigureRewardTaskAwarder(membershipSvc)
	publicFoodHandler := publicfoodhandler.NewPublicFoodHandler(publicFoodSvc)

	// Recipe module DI
	recipeRepo := reciperepo.NewRecipeRepo(db)
	recipeSvc := recipeservice.NewRecipeService(recipeRepo, storageClient)
	recipeSvc.ConfigureWaterLogRecorder(bodyMetricsRepo)
	recipeHandler := recipehandler.NewRecipeHandler(recipeSvc)

	// Expiry module DI
	expiryRepo := expiryrepo.NewExpiryRepo(db)
	expiryTaskRepo := expiryrepo.NewTaskRepo(db)
	expiryRecognizer := expiryservice.NewRecognizer(cfg)
	expiryNotifier := expiryservice.NewNotificationWorker(expiryRepo, cfg)
	expirySvc := expiryservice.NewExpiryService(expiryRepo, expiryTaskRepo, expiryRecognizer)
	expirySvc.ConfigureNotificationTemplate(cfg.WechatPay.ExpirySubscribeTemplateID)
	expirySvc.ConfigureCreditGuard(membershipSvc)
	expirySvc.ConfigureStorage(storageClient)
	expiryHandler := expiryhandler.NewExpiryHandler(expirySvc)

	// Utility module DI
	locationSvc := utilityservice.NewLocationService(cfg)
	qrcodeSvc := utilityservice.NewQRCodeService(cfg)
	manualFoodRepo := utilityrepo.NewManualFoodRepo(db, storageClient)
	manualFoodSvc := utilityservice.NewManualFoodService(manualFoodRepo)
	utilityHandler := utilityhandler.NewUtilityHandler(locationSvc, qrcodeSvc, manualFoodSvc)

	// TestBackend module DI
	testBackendPromptRepo := testbackendrepo.NewPromptRepo(db)
	testBackendBatchRepo := testbackendrepo.NewBatchRepo(db)
	testBackendDatasetRepo := testbackendrepo.NewDatasetRepo(db)
	testBackendSvc := testbackendservice.NewTestBackendService(testBackendPromptRepo, testBackendBatchRepo, testBackendDatasetRepo, doubaoClient, ofoxAIClient, userRepo, jwtSvc, cfg)
	testBackendHandler := testbackendhandler.NewTestBackendHandler(testBackendSvc)

	commentHandler := communityhandler.NewCommentHandler(homeRepo, userRepo)
	system := systemhandler.New()

	app := &App{
		engine:        engine,
		db:            db,
		log:           log,
		shutdownTrace: traceShutdown,
		shutdownLog:   logShutdown,
		taskQueue:     taskQueue,
	}
	app.startEmbeddedWorker(cfg, analyzeTaskRepo, analyzePrecisionRepo, publicFoodRepo, analyzeSvc, ocrSvc, healthDocRepo, userRepo, expiryRecognizer, expiryNotifier, exerciseSvc, frNutritionSvc, membershipSvc, taskQueue, storageClient)

	engine.POST("/api/login", loginHandler.Login)
	engine.GET("/api", system.Root)
	engine.GET("/api/health", system.Health)
	engine.GET("/map-picker", system.MapPicker)
	engine.GET("/test-backend", system.TestBackendPage)
	engine.GET("/test-backend/login", system.TestBackendLoginPage)
	engine.Static("/static/test_backend", filepath.Join("static", "test_backend"))
	engine.GET("/ws/stats/insight", statsInsightWebsocket(statsSvc))

	// User routes
	engine.GET("/api/user/profile", authmw.RequireJWT(jwtSvc), userHandler.GetProfile)
	engine.PUT("/api/user/profile", authmw.RequireJWT(jwtSvc), userHandler.UpdateProfile)
	engine.POST("/api/user/bind-phone", authmw.RequireJWT(jwtSvc), userHandler.BindPhone)
	engine.POST("/api/user/upload-avatar", authmw.RequireJWT(jwtSvc), userHandler.UploadAvatar)
	engine.GET("/api/user/dashboard-targets", authmw.RequireJWT(jwtSvc), userHandler.GetDashboardTargets)
	engine.PUT("/api/user/dashboard-targets", authmw.RequireJWT(jwtSvc), userHandler.UpdateDashboardTargets)
	engine.GET("/api/user/health-profile", authmw.RequireJWT(jwtSvc), userHandler.GetHealthProfile)
	engine.PUT("/api/user/health-profile", authmw.RequireJWT(jwtSvc), userHandler.UpdateHealthProfile)
	engine.GET("/api/user/health-focuses", authmw.RequireJWT(jwtSvc), userHandler.GetHealthFocuses)
	engine.PUT("/api/user/health-focuses", authmw.RequireJWT(jwtSvc), userHandler.UpdateHealthFocuses)
	engine.POST("/api/user/health-focuses", authmw.RequireJWT(jwtSvc), userHandler.AddHealthFocus)
	engine.DELETE("/api/user/health-focuses/:focus_id", authmw.RequireJWT(jwtSvc), userHandler.RemoveHealthFocus)
	engine.POST("/api/user/health-profile/ocr", authmw.RequireJWT(jwtSvc), userHandler.HealthReportOCR)
	engine.POST("/api/user/health-profile/ocr-extract", authmw.RequireJWT(jwtSvc), userHandler.HealthReportOCRExtract)
	engine.POST("/api/user/health-profile/submit-report-extraction-task", authmw.RequireJWT(jwtSvc), userHandler.SubmitReportExtractionTask)
	engine.POST("/api/user/health-profile/upload-report-image", authmw.RequireJWT(jwtSvc), userHandler.UploadReportImage)
	engine.GET("/api/user/record-days", authmw.RequireJWT(jwtSvc), userHandler.GetRecordDays)
	engine.POST("/api/user/last-seen-analyze-history", authmw.RequireJWT(jwtSvc), userHandler.UpdateLastSeenAnalyzeHistory)
	engine.POST("/api/user/acknowledge-health-disclaimer", authmw.RequireJWT(jwtSvc), userHandler.AcknowledgeHealthDisclaimer)
	engine.DELETE("/api/user/account", authmw.RequireJWT(jwtSvc), userHandler.DeleteAccount)

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
	engine.POST("/api/precision-sessions/:session_id/continue", authmw.RequireJWT(jwtSvc), analyzeHandler.ContinuePrecisionSession)

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
	engine.POST("/api/packaged-food", authmw.RequireJWT(jwtSvc), frHandler.CreatePackagedFood)
	engine.POST("/api/packaged-food/extract/submit", authmw.RequireJWT(jwtSvc), frHandler.SubmitPackagedProductExtractTask)
	engine.POST("/api/packaged-food/nutrition-label/recognize", authmw.RequireJWT(jwtSvc), frHandler.RecognizePackagedNutritionLabel)
	engine.POST("/api/packaged-food/nutrition-label/submit", authmw.RequireJWT(jwtSvc), frHandler.SubmitPackagedNutritionLabelTask)
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
	engine.POST("/api/community/feed-targets/:target_type/:target_id/like", authmw.RequireJWT(jwtSvc), communityHandler.LikeFeedTarget)
	engine.DELETE("/api/community/feed-targets/:target_type/:target_id/like", authmw.RequireJWT(jwtSvc), communityHandler.UnlikeFeedTarget)
	engine.GET("/api/community/feed-targets/:target_type/:target_id/comments", authmw.RequireJWT(jwtSvc), communityHandler.ListTargetComments)
	engine.POST("/api/community/feed-targets/:target_type/:target_id/comments", authmw.RequireJWT(jwtSvc), communityHandler.PostTargetComment)
	engine.DELETE("/api/community/feed-targets/:target_type/:target_id/comments/:comment_id", authmw.RequireJWT(jwtSvc), communityHandler.DeleteTargetComment)
	engine.GET("/api/community/feed-targets/:target_type/:target_id/context", authmw.RequireJWT(jwtSvc), communityHandler.FeedTargetContext)
	engine.POST("/api/community/feed-targets/:target_type/:target_id/hide", authmw.RequireJWT(jwtSvc), communityHandler.HideFeedTarget)
	engine.GET("/api/community/comment-tasks", authmw.RequireJWT(jwtSvc), communityHandler.ListCommentTasks)
	engine.GET("/api/community/notifications", authmw.RequireJWT(jwtSvc), communityHandler.ListNotifications)
	engine.POST("/api/community/notifications/read", authmw.RequireJWT(jwtSvc), communityHandler.MarkNotificationsRead)

	// Health routes
	engine.GET("/api/body-metrics/summary", authmw.RequireJWT(jwtSvc), healthHandler.GetBodyMetricsSummary)
	engine.POST("/api/body-metrics/sync-local", authmw.RequireJWT(jwtSvc), healthHandler.SyncLocalBodyMetrics)
	engine.POST("/api/body-metrics/water", authmw.RequireJWT(jwtSvc), healthHandler.SaveBodyWaterLog)
	engine.POST("/api/body-metrics/water/reset", authmw.RequireJWT(jwtSvc), healthHandler.ResetBodyWaterLogs)
	engine.DELETE("/api/body-metrics/water/:log_id", authmw.RequireJWT(jwtSvc), healthHandler.DeleteBodyWaterLog)
	engine.POST("/api/body-metrics/weight", authmw.RequireJWT(jwtSvc), healthHandler.SaveBodyWeightRecord)
	engine.DELETE("/api/body-metrics/weight/:record_id", authmw.RequireJWT(jwtSvc), healthHandler.DeleteBodyWeightRecord)
	engine.GET("/api/stats/summary", authmw.RequireJWT(jwtSvc), healthHandler.GetStatsSummary)
	engine.POST("/api/stats/custom-focus/generate", authmw.RequireJWT(jwtSvc), healthHandler.GenerateCustomFocusCard)
	engine.POST("/api/stats/insight/generate", authmw.RequireJWT(jwtSvc), healthHandler.GenerateStatsInsight)
	engine.POST("/api/stats/insight/save", authmw.RequireJWT(jwtSvc), healthHandler.SaveStatsInsight)
	engine.POST("/api/diet/recommendations", authmw.RequireJWT(jwtSvc), healthHandler.GenerateDietRecommendation)
	engine.GET("/api/exercise-calories/daily", authmw.RequireJWT(jwtSvc), healthHandler.GetExerciseCaloriesDaily)
	engine.GET("/api/exercise-logs", authmw.RequireJWT(jwtSvc), healthHandler.GetExerciseLogs)
	engine.POST("/api/exercise-logs", authmw.RequireJWT(jwtSvc), healthHandler.CreateExerciseLog)
	engine.POST("/api/exercise-logs/estimate-calories", authmw.RequireJWT(jwtSvc), healthHandler.EstimateExerciseCalories)
	engine.DELETE("/api/exercise-logs/:log_id", authmw.RequireJWT(jwtSvc), healthHandler.DeleteExerciseLog)

	// Membership routes
	engine.GET("/api/membership/plans", membershipHandler.ListPlans)
	engine.GET("/api/membership/me", authmw.RequireJWT(jwtSvc), membershipHandler.GetMyMembership)
	engine.GET("/api/membership/reward-center", authmw.RequireJWT(jwtSvc), membershipHandler.GetRewardCenter)
	engine.POST("/api/membership/pay/create", authmw.RequireJWT(jwtSvc), membershipHandler.CreatePayment)
	engine.POST("/api/payment/wechat/notify/membership", membershipHandler.WechatNotify)
	engine.POST("/api/membership/rewards/share-poster/claim", authmw.RequireJWT(jwtSvc), membershipHandler.ClaimSharePosterReward)

	// Pet companion routes
	engine.GET("/api/pet/summary", authmw.RequireJWT(jwtSvc), petHandler.Summary)
	engine.POST("/api/pet/events/:event_id/claim", authmw.RequireJWT(jwtSvc), petHandler.ClaimEvent)
	engine.POST("/api/pet/select-appearance", authmw.RequireJWT(jwtSvc), petHandler.SelectAppearance)
	engine.POST("/api/pet/reroll-appearance", authmw.RequireJWT(jwtSvc), petHandler.RerollAppearance)

	// Public food library routes
	engine.GET("/api/public-food-library", authmw.RequireJWT(jwtSvc), publicFoodHandler.List)
	engine.POST("/api/public-food-library", authmw.RequireJWT(jwtSvc), publicFoodHandler.Create)
	engine.GET("/api/public-food-library/mine", authmw.RequireJWT(jwtSvc), publicFoodHandler.Mine)
	engine.GET("/api/public-food-library/collections", authmw.RequireJWT(jwtSvc), publicFoodHandler.Collections)
	engine.POST("/api/public-food-library/feedback", authmw.RequireJWT(jwtSvc), publicFoodHandler.Feedback)
	engine.GET("/api/public-food-library/:item_id", authmw.RequireJWT(jwtSvc), publicFoodHandler.Get)
	engine.POST("/api/public-food-library/:item_id/like", authmw.RequireJWT(jwtSvc), publicFoodHandler.Like)
	engine.DELETE("/api/public-food-library/:item_id/like", authmw.RequireJWT(jwtSvc), publicFoodHandler.Unlike)
	engine.POST("/api/public-food-library/:item_id/collect", authmw.RequireJWT(jwtSvc), publicFoodHandler.Collect)
	engine.DELETE("/api/public-food-library/:item_id/collect", authmw.RequireJWT(jwtSvc), publicFoodHandler.Uncollect)
	engine.DELETE("/api/public-food-library/:item_id", authmw.RequireJWT(jwtSvc), publicFoodHandler.Delete)
	engine.GET("/api/public-food-library/:item_id/comments", authmw.RequireJWT(jwtSvc), publicFoodHandler.Comments)
	engine.POST("/api/public-food-library/:item_id/comments", authmw.RequireJWT(jwtSvc), publicFoodHandler.AddComment)

	// Recipe routes
	engine.GET("/api/recipes", authmw.RequireJWT(jwtSvc), recipeHandler.List)
	engine.POST("/api/recipes", authmw.RequireJWT(jwtSvc), recipeHandler.Create)
	engine.GET("/api/recipes/count", authmw.RequireJWT(jwtSvc), recipeHandler.Count)
	engine.GET("/api/recipes/:recipe_id", authmw.RequireJWT(jwtSvc), recipeHandler.Get)
	engine.PUT("/api/recipes/:recipe_id", authmw.RequireJWT(jwtSvc), recipeHandler.Update)
	engine.DELETE("/api/recipes/:recipe_id", authmw.RequireJWT(jwtSvc), recipeHandler.Delete)
	engine.POST("/api/recipes/:recipe_id/use", authmw.RequireJWT(jwtSvc), recipeHandler.Use)

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
	engine.GET("/api/miniprogram/launch-url", utilityHandler.MiniProgramLaunchURL)
	engine.GET("/api/manual-food/browse", authmw.OptionalJWT(jwtSvc), utilityHandler.ManualFoodBrowse)
	engine.GET("/api/manual-food/catalog", authmw.OptionalJWT(jwtSvc), utilityHandler.ManualFoodCatalog)
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
	engine.POST("/api/test-backend/impersonate-user", testBackendHandler.ImpersonateUser)
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
		log.Warn("路由映射文件缺失，已跳过存根路由注册", slog.String("path", routeMapPath))
	}

	return app, nil
}

func (a *App) Engine() *gin.Engine {
	return a.engine
}

func shouldTraceHTTPRequest(req *http.Request) bool {
	if req == nil || req.URL == nil {
		return true
	}
	return strings.TrimSpace(req.URL.Path) != "/api/health"
}

func (a *App) startEmbeddedWorker(
	cfg *config.Config,
	taskRepo *analyzerepo.TaskRepo,
	precisionRepo *analyzerepo.PrecisionRepo,
	publicFoodRepo *publicfoodrepo.PublicFoodRepo,
	analyzeSvc *analyzeservice.AnalyzeService,
	ocrSvc *userservice.OCRService,
	healthDocRepo *userrepo.HealthDocumentRepo,
	userRepo *authrepo.UserRepo,
	expiryRecognizer *expiryservice.Recognizer,
	expiryNotifier *expiryservice.NotificationWorker,
	exerciseSvc *healthservice.ExerciseService,
	nutritionSvc *foodrecordservice.FoodNutritionService,
	membershipSvc *membershipservice.MembershipService,
	taskQueue taskqueue.Queue,
	storageClient *storage.Client,
) {
	workerCount := cfg.Worker.Count
	metrics.SetWorkerConfigured(cfg.TaskQueue.Driver, workerCount)
	if workerCount <= 0 {
		a.log.Info("内嵌 worker 已禁用", slog.Int("worker_count", workerCount))
		return
	}

	workerID := embeddedWorkerID(cfg)
	pollInterval := time.Duration(cfg.Worker.PollIntervalSeconds * float64(time.Second))
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	taskTypes := workerpkg.SupportedTaskTypes()

	runner := workerpkg.NewRunner(
		taskRepo,
		precisionRepo,
		publicFoodRepo,
		analyzeSvc,
		ocrSvc,
		healthDocRepo,
		userRepo,
		expiryRecognizer,
		expiryNotifier,
		exerciseSvc,
		nutritionSvc,
		taskQueue,
		a.log,
		storageClient,
	)
	runner.ConfigureCreditGuard(membershipSvc)

	workerCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	a.workerCancel = cancel
	a.workerDone = done

	a.log.Info("内嵌 worker 已启用",
		slog.String("worker_id", workerID),
		slog.Any("task_types", taskTypes),
		slog.String("task_queue_driver", cfg.TaskQueue.Driver),
		slog.Duration("poll_interval", pollInterval),
		slog.Int("worker_count", workerCount),
	)
	go func() {
		defer close(done)
		for workerCtx.Err() == nil {
			err := runner.Run(workerCtx, workerpkg.Options{
				WorkerID:     workerID,
				TaskTypes:    taskTypes,
				PollInterval: pollInterval,
				WorkerCount:  workerCount,
				QueueDriver:  cfg.TaskQueue.Driver,
			})
			if err == nil || err == context.Canceled || workerCtx.Err() != nil {
				break
			}
			a.log.Error("内嵌 worker 异常停止，准备重启", logger.Err(err))
			timer := time.NewTimer(2 * time.Second)
			select {
			case <-workerCtx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
		a.log.Info("内嵌 worker 已停止")
	}()
}

func embeddedWorkerID(cfg *config.Config) string {
	if cfg.Worker.ID != "" {
		return cfg.Worker.ID
	}
	if host, err := os.Hostname(); err == nil && host != "" {
		return host + "-embedded"
	}
	return "food-link-server-embedded-worker"
}

func (a *App) Close(ctx context.Context) error {
	if a.workerCancel != nil {
		a.workerCancel()
	}
	if a.workerDone != nil {
		select {
		case <-a.workerDone:
		case <-ctx.Done():
			a.log.Warn("内嵌 worker 关闭超时", logger.Err(ctx.Err()))
		}
	}
	if a.taskQueue != nil {
		if err := a.taskQueue.Close(ctx); err != nil {
			return err
		}
	}
	if a.shutdownTrace != nil {
		if err := a.shutdownTrace(ctx); err != nil {
			return err
		}
	}
	if a.shutdownLog != nil {
		if err := a.shutdownLog(ctx); err != nil {
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

func statsInsightWebsocket(statsSvc *healthservice.StatsService) gin.HandlerFunc {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	return func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		userID := strings.TrimSpace(c.Query("user_id"))
		if userID == "" {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "user_id required"), time.Now().Add(time.Second))
			return
		}
		statsRange := c.DefaultQuery("range", "week")
		if statsRange != "week" && statsRange != "month" {
			statsRange = "week"
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
		defer cancel()
		result, err := statsSvc.GenerateInsight(ctx, userID, statsRange, 2000, 0)
		if err != nil {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "generate insight failed"), time.Now().Add(time.Second))
			return
		}
		text := strings.TrimSpace(fmt.Sprintf("%v", result["analysis_summary"]))
		if text == "" || text == "<nil>" {
			text = "本期暂无足够记录生成洞察，请继续记录饮食后再查看。"
		}
		chunkSize := 8
		runes := []rune(text)
		for i := 0; i < len(runes); i += chunkSize {
			end := i + chunkSize
			if end > len(runes) {
				end = len(runes)
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(string(runes[i:end]))); err != nil {
				return
			}
			time.Sleep(40 * time.Millisecond)
		}
	}
}
