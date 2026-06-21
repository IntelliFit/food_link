package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"food_link/backend/internal/app"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
)

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	application, err := app.New(cfg)
	if err != nil {
		log.Fatalf("初始化应用失败: %v", err)
	}

	server := &http.Server{
		Addr:         cfg.ListenAddr(),
		Handler:      application.Engine(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		logger.Info(context.Background(), "后端服务开始监听", slog.String("listen_addr", cfg.ListenAddr()))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error(context.Background(), "后端服务监听失败", err, slog.String("listen_addr", cfg.ListenAddr()))
			os.Exit(1)
		}
	}()

	stopCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-stopCtx.Done()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error(context.Background(), "后端服务关闭失败", err)
	}
	if err := application.Close(ctx); err != nil {
		logger.Error(context.Background(), "应用资源关闭失败", err)
	}
}
