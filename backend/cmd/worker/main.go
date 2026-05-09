package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	expiryrepo "food_link/backend/internal/expiry/repo"
	expiryservice "food_link/backend/internal/expiry/service"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	healthrepo "food_link/backend/internal/health/repo"
	healthservice "food_link/backend/internal/health/service"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	userrepo "food_link/backend/internal/user/repo"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/internal/worker"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	zapLog, err := logger.New(cfg.App.Env)
	if err != nil {
		log.Fatalf("init logger: %v", err)
	}
	logger.SetGlobal(zapLog)
	defer func() { _ = zapLog.Sync() }()

	db, err := database.Open(cfg.Database)
	if err != nil {
		zapLog.Fatal("open database", zap.Error(err))
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}

	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	publicFoodRepo := publicfoodrepo.NewPublicFoodRepo(db)
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	expiryRepo := expiryrepo.NewExpiryRepo(db)
	exerciseRepo := healthrepo.NewExerciseRepo(db)
	storageClient := storage.New(cfg.Storage)

	dashScopeClient := analyzeservice.NewDashScopeClient(cfg.External.DashscopeAPIKey, "qwen-vl-max")
	ofoxAIClient := analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, "gemini-3-flash-preview", cfg.External.OfoxAIBaseURL)
	analyzeSvc := analyzeservice.NewAnalyzeService(dashScopeClient, ofoxAIClient, userRepo, nutritionRepo)
	analyzeSvc.ConfigureDeepSeekFallback(cfg.External.DeepSeekAPIKey)
	analyzeSvc.ConfigureStorage(storageClient)
	ocrSvc := userservice.NewOCRService(cfg, storageClient)
	expiryRecognizer := expiryservice.NewRecognizer(cfg)
	expiryNotifier := expiryservice.NewNotificationWorker(expiryRepo, cfg)
	exerciseSvc := healthservice.NewExerciseService(exerciseRepo, cfg)
	exerciseSvc.ConfigureStorage(storageClient)

	runner := worker.NewRunner(taskRepo, precisionRepo, publicFoodRepo, analyzeSvc, ocrSvc, healthDocRepo, userRepo, expiryRecognizer, expiryNotifier, exerciseSvc, zapLog, storageClient)
	workerID := cfg.Worker.ID
	if workerID == "" {
		if host, hostErr := os.Hostname(); hostErr == nil && host != "" {
			workerID = host
		} else {
			workerID = "food-link-worker"
		}
	}
	pollInterval := time.Duration(cfg.Worker.PollIntervalSeconds * float64(time.Second))
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	maxConcurrent := cfg.Worker.MaxConcurrent
	if maxConcurrent <= 0 {
		maxConcurrent = 4
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	err = runner.Run(ctx, worker.Options{
		WorkerID:      workerID,
		TaskTypes:     cfg.Worker.TaskTypes,
		PollInterval:  pollInterval,
		MaxConcurrent: maxConcurrent,
	})
	if err != nil && err != context.Canceled {
		zapLog.Fatal("worker stopped", zap.Error(err))
	}
}
