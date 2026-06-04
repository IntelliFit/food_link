package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	membershipservice "food_link/backend/internal/membership/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	since := flag.String("since", "2026-05-29", "include pending orders created at or after this date/time")
	limit := flag.Int("limit", 100, "maximum pending orders to inspect")
	apply := flag.Bool("apply", false, "write successful WeChat payments back to the database")
	flag.Parse()

	ctx := context.Background()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}

	start, err := parseSince(*since)
	if err != nil {
		log.Fatalf("parse since: %v", err)
	}

	var rows []domain.MembershipPayment
	if err := db.WithContext(ctx).
		Where("status = ? AND created_at >= ?", "pending", start).
		Order("created_at ASC").
		Limit(*limit).
		Find(&rows).Error; err != nil {
		log.Fatalf("query pending payments: %v", err)
	}

	repo := membershiprepo.NewMembershipRepo(db)
	svc := membershipservice.NewMembershipService(repo, cfg)
	fmt.Printf("mode=%s config_source=%s pending_count=%d since=%s limit=%d\n", mode(*apply), cfg.ConfigSource, len(rows), start.Format(time.RFC3339), *limit)

	var synced, notPaid, failed, alreadyPaid int
	for _, row := range rows {
		createdAt := ""
		if row.CreatedAt != nil {
			createdAt = row.CreatedAt.In(chinaLocation()).Format(time.RFC3339)
		}
		if !*apply {
			fmt.Printf("DRY order=%s user=%s plan=%s amount=%.2f created=%s action=query_only\n", row.OrderNo, maskID(row.UserID), row.PlanCode, row.Amount, createdAt)
			continue
		}
		data, err := svc.SyncWechatPayment(ctx, row.UserID, row.OrderNo)
		if err != nil {
			failed++
			fmt.Printf("ERR order=%s user=%s plan=%s amount=%.2f created=%s err=%v\n", row.OrderNo, maskID(row.UserID), row.PlanCode, row.Amount, createdAt, err)
			continue
		}
		status := strings.TrimSpace(fmt.Sprint(data["status"]))
		tradeState := strings.TrimSpace(fmt.Sprint(data["trade_state"]))
		syncedValue, _ := data["synced"].(bool)
		switch {
		case syncedValue && status == "paid":
			synced++
			fmt.Printf("SYNCED order=%s user=%s plan=%s amount=%.2f created=%s trade_state=%s\n", row.OrderNo, maskID(row.UserID), row.PlanCode, row.Amount, createdAt, tradeState)
		case status == "paid":
			alreadyPaid++
			fmt.Printf("PAID order=%s user=%s plan=%s amount=%.2f created=%s trade_state=%s\n", row.OrderNo, maskID(row.UserID), row.PlanCode, row.Amount, createdAt, tradeState)
		default:
			notPaid++
			fmt.Printf("SKIP order=%s user=%s plan=%s amount=%.2f created=%s status=%s trade_state=%s\n", row.OrderNo, maskID(row.UserID), row.PlanCode, row.Amount, createdAt, status, tradeState)
		}
	}
	fmt.Printf("summary mode=%s inspected=%d synced=%d already_paid=%d not_paid=%d failed=%d\n", mode(*apply), len(rows), synced, alreadyPaid, notPaid, failed)
}

func parseSince(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, value, chinaLocation()); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported time %q", value)
}

func chinaLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

func mode(apply bool) string {
	if apply {
		return "apply"
	}
	return "dry-run"
}

func maskID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 8 {
		return value
	}
	return value[:8] + "..."
}
