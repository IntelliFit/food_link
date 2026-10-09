package config

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"
)

// ApplyLocalWorkerSafety is a disable-only override, independent of Apollo's
// configured worker count. Development launchers always set this process flag.
func (cfg *Config) ApplyLocalWorkerSafety() {
	if os.Getenv("FOODLINK_DISABLE_WORKERS") != "1" && !strings.EqualFold(strings.TrimSpace(cfg.Apollo.Cluster), "local") {
		return
	}
	if cfg.Worker.Count > 0 {
		slog.Warn("本地开发安全保护已禁用任务 worker", slog.Int("previous_worker_count", cfg.Worker.Count))
	}
	cfg.Worker.Count = 0
}

// ValidateWorkerIsolation runs before opening any database or starting workers.
// An in-memory queue still recovers tasks by scanning the database, so giving
// it a different topic does not isolate it from remote deployments.
func (cfg *Config) ValidateWorkerIsolation() error {
	if cfg.Worker.Count <= 0 || workerDatabaseIsLocal(cfg.Database) {
		return nil
	}
	localConfig := strings.EqualFold(cfg.ConfigSource, "local") &&
		!strings.EqualFold(strings.TrimSpace(cfg.App.Env), "production")
	if localConfig || strings.EqualFold(strings.TrimSpace(cfg.TaskQueue.Driver), "memory") || strings.TrimSpace(cfg.TaskQueue.Driver) == "" {
		return fmt.Errorf("禁止本地 worker 消费远程数据库中的任务：请将 worker.count 设为 0，或使用独立本地数据库；修改队列名称不能隔离数据库恢复扫描")
	}
	return nil
}

func workerDatabaseIsLocal(cfg DatabaseConfig) bool {
	host := strings.Trim(strings.TrimSpace(cfg.Host), "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
