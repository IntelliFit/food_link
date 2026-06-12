package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	adminrepo "food_link/backend/internal/admin/repo"
	adminservice "food_link/backend/internal/admin/service"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"golang.org/x/term"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	username := flag.String("username", "", "admin username")
	displayName := flag.String("display-name", "", "admin display name")
	password := flag.String("password", "", "admin password; if omitted, prompt from terminal")
	reset := flag.Bool("reset", false, "reset password if admin already exists")
	skipMigration := flag.Bool("skip-migration", false, "skip AutoMigrate before creating or resetting the admin account")
	timeout := flag.Duration("timeout", 2*time.Minute, "operation timeout")
	flag.Parse()

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	adminPassword, err := resolvePassword(*password)
	if err != nil {
		log.Fatalf("读取密码失败: %v", err)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if !*skipMigration {
		if err := migration.AutoMigrate(ctx, db, cfg.Database.Schema); err != nil {
			log.Fatalf("自动迁移失败: %v", err)
		}
	}

	repo := adminrepo.NewAdminAccountRepo(db)
	svc := adminservice.NewAuthService(repo)
	account, err := svc.CreateOrResetAdmin(ctx, adminservice.CreateAdminInput{
		Username:    *username,
		Password:    adminPassword,
		DisplayName: *displayName,
		Reset:       *reset,
	})
	if err != nil {
		log.Fatalf("创建管理员失败: %v", err)
	}
	log.Printf("管理员账号已就绪: config_dir=%s username=%s display_name=%s id=%s", resolvedDir, account.Username, account.DisplayName, account.ID)
}

func resolvePassword(flagPassword string) (string, error) {
	password := strings.TrimSpace(flagPassword)
	if password != "" {
		return password, nil
	}
	fmt.Fprint(os.Stderr, "请输入管理员密码: ")
	first, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "请再次输入管理员密码: ")
	second, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", fmt.Errorf("两次输入的密码不一致")
	}
	return string(first), nil
}

func loadConfig(configDir string) (*config.Config, string, error) {
	candidates := []string{configDir}
	if configDir == "." {
		candidates = append(candidates, "backend", filepath.Join("food_link", "backend"), filepath.Join("..", ".."))
	}
	var firstErr error
	for _, dir := range candidates {
		cfg, err := config.Load(dir)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if hasConfigFile(dir) || hasDatabaseConfig(cfg) {
			return cfg, dir, nil
		}
	}
	if firstErr != nil {
		return nil, "", firstErr
	}
	return nil, "", fmt.Errorf("config.yaml not found and database env vars are incomplete")
}

func hasConfigFile(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "config.yaml"))
	return err == nil && !info.IsDir()
}

func hasDatabaseConfig(cfg *config.Config) bool {
	return cfg != nil && cfg.Database.Host != "" && cfg.Database.Name != "" && cfg.Database.User != ""
}
