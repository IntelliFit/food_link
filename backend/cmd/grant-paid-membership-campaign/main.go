package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

const defaultCampaignID = "paid-membership-two-weeks-20260821"

var campaignIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,80}$`)

type campaignReport struct {
	GeneratedAt    time.Time              `json:"generated_at"`
	DatabaseTarget string                 `json:"database_target"`
	CampaignID     string                 `json:"campaign_id"`
	GrantDays      int                    `json:"grant_days"`
	Apply          bool                   `json:"apply"`
	EligibleUsers  int                    `json:"eligible_users"`
	AppliedUsers   int                    `json:"applied_users"`
	AlreadyGranted int                    `json:"already_granted_users"`
	SkippedUsers   int                    `json:"skipped_users"`
	FailedUsers    int                    `json:"failed_users"`
	Targets        []campaignTargetReport `json:"targets"`
}

type campaignTargetReport struct {
	UserID            string     `json:"user_id"`
	Nickname          string     `json:"nickname"`
	LastPaidOrderNo   string     `json:"last_paid_order_no"`
	LastPaidAt        *time.Time `json:"last_paid_at,omitempty"`
	LastPaidPlanCode  string     `json:"last_paid_plan_code"`
	MembershipBefore  string     `json:"membership_before"`
	PlanCode          string     `json:"plan_code"`
	AutoRenewBefore   bool       `json:"auto_renew_before"`
	ExpiresAtBefore   *time.Time `json:"expires_at_before,omitempty"`
	ExpectedStartsAt  time.Time  `json:"expected_starts_at"`
	ExpectedExpiresAt time.Time  `json:"expected_expires_at"`
	SourceKey         string     `json:"source_key"`
	Action            string     `json:"action"`
	Applied           bool       `json:"applied"`
	AlreadyGranted    bool       `json:"already_granted"`
	ActualPlanCode    string     `json:"actual_plan_code,omitempty"`
	ActualAutoRenew   *bool      `json:"actual_auto_renew,omitempty"`
	ActualExpiresAt   *time.Time `json:"actual_expires_at,omitempty"`
	SkipReason        string     `json:"skip_reason,omitempty"`
	Error             string     `json:"error,omitempty"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config.yaml")
	campaignID := flag.String("campaign-id", defaultCampaignID, "stable idempotency namespace for this campaign")
	grantDays := flag.Int("grant-days", 14, "membership days to grant to every eligible paid user")
	apply := flag.Bool("apply", false, "write membership grants; dry-run by default")
	confirmDB := flag.String("confirm-db", "", "required with --apply; must equal host/database/schema")
	reportOutput := flag.String("report-output", "", "JSON audit report path")
	timeout := flag.Duration("timeout", 2*time.Minute, "overall campaign timeout")
	flag.Parse()

	if !campaignIDPattern.MatchString(strings.TrimSpace(*campaignID)) {
		log.Fatalf("活动 ID 非法: %q", *campaignID)
	}
	if *grantDays <= 0 {
		log.Fatal("赠送天数必须大于 0")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}

	schema := strings.TrimSpace(cfg.Database.Schema)
	if schema == "" {
		schema = "public"
	}
	target := databaseTarget(cfg.Database.Host, cfg.Database.Name, schema)
	if *apply && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}

	repo := membershiprepo.NewMembershipRepo(db)
	rows, err := repo.ListLatestRealPaidMembershipPayments(ctx)
	if err != nil {
		log.Fatalf("读取真实付费用户失败: %v", err)
	}
	report := campaignReport{
		GeneratedAt: time.Now(), DatabaseTarget: target, CampaignID: strings.TrimSpace(*campaignID),
		GrantDays: *grantDays, Apply: *apply, Targets: make([]campaignTargetReport, 0, len(rows)),
	}
	for _, payment := range rows {
		item := buildTarget(ctx, repo, payment, report.CampaignID, *grantDays)
		if item.SkipReason != "" || item.Error != "" {
			report.SkippedUsers++
			report.Targets = append(report.Targets, item)
			continue
		}
		report.EligibleUsers++
		if *apply {
			applyTarget(ctx, repo, payment, &item, report.CampaignID, *grantDays)
			switch {
			case item.Error != "":
				report.FailedUsers++
			case item.Applied:
				report.AppliedUsers++
			case item.AlreadyGranted:
				report.AlreadyGranted++
			}
		}
		report.Targets = append(report.Targets, item)
	}
	sort.Slice(report.Targets, func(i, j int) bool {
		if report.Targets[i].Nickname != report.Targets[j].Nickname {
			return report.Targets[i].Nickname < report.Targets[j].Nickname
		}
		return report.Targets[i].UserID < report.Targets[j].UserID
	})
	writeReport(report, *reportOutput)
	log.Printf("付费用户会员赠送完成：模式=%s 活动=%s 合格=%d 已发放=%d 已存在=%d 跳过=%d 失败=%d", mode(*apply), report.CampaignID, report.EligibleUsers, report.AppliedUsers, report.AlreadyGranted, report.SkippedUsers, report.FailedUsers)
}

func buildTarget(ctx context.Context, repo *membershiprepo.MembershipRepo, payment domain.MembershipPayment, campaignID string, grantDays int) campaignTargetReport {
	item := campaignTargetReport{
		UserID: payment.UserID, LastPaidOrderNo: payment.OrderNo, LastPaidAt: payment.PaidAt,
		LastPaidPlanCode: payment.PlanCode, SourceKey: sourceKey(campaignID, payment.UserID),
	}
	user, err := repo.GetUser(ctx, payment.UserID)
	if err != nil {
		item.Error = fmt.Sprintf("读取用户失败: %v", err)
		return item
	}
	if user == nil {
		item.SkipReason = "用户不存在"
		return item
	}
	item.Nickname = nicknameOf(user)
	membership, err := repo.GetUserProMembership(ctx, payment.UserID)
	if err != nil {
		item.Error = fmt.Sprintf("读取会员失败: %v", err)
		return item
	}
	now := time.Now()
	planCode := strings.TrimSpace(payment.PlanCode)
	start := now
	if membership != nil {
		item.MembershipBefore = membership.Status
		item.AutoRenewBefore = membership.AutoRenew
		item.ExpiresAtBefore = membership.ExpiresAt
		if membership.Status == "active" && membership.ExpiresAt != nil && membership.ExpiresAt.After(now) {
			item.Action = "extend_active_membership"
			start = *membership.ExpiresAt
			if membership.CurrentPlanCode != nil && strings.TrimSpace(*membership.CurrentPlanCode) != "" {
				planCode = strings.TrimSpace(*membership.CurrentPlanCode)
			}
		} else {
			item.Action = "reactivate_last_paid_plan"
		}
	} else {
		item.MembershipBefore = "none"
		item.Action = "create_last_paid_plan"
	}
	plan, err := repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		item.Error = fmt.Sprintf("读取会员套餐失败: %v", err)
		return item
	}
	if plan == nil {
		item.SkipReason = "套餐配置不存在: " + planCode
		return item
	}
	item.PlanCode = planCode
	item.ExpectedStartsAt = start
	item.ExpectedExpiresAt = start.AddDate(0, 0, grantDays)
	return item
}

func applyTarget(ctx context.Context, repo *membershiprepo.MembershipRepo, payment domain.MembershipPayment, item *campaignTargetReport, campaignID string, grantDays int) {
	plan, err := repo.GetPlanByCode(ctx, item.PlanCode)
	if err != nil || plan == nil {
		if err != nil {
			item.Error = fmt.Sprintf("执行前读取套餐失败: %v", err)
		} else {
			item.Error = "执行前套餐配置不存在"
		}
		return
	}
	grant, membership, applied, err := repo.GrantMembership(ctx, domain.MembershipGrantInput{
		UserID:       payment.UserID,
		SourceType:   "paid_membership_campaign",
		SourceKey:    item.SourceKey,
		PlanCode:     item.PlanCode,
		DailyCredits: plan.DailyCredits,
		GrantDays:    grantDays,
		Meta: map[string]any{
			"campaign_id":         campaignID,
			"campaign_kind":       "paid_membership_two_weeks",
			"last_paid_order_no":  payment.OrderNo,
			"last_paid_plan_code": payment.PlanCode,
			"grant_days":          grantDays,
		},
	})
	if err != nil {
		item.Error = fmt.Sprintf("发放会员失败: %v", err)
		return
	}
	item.Applied = applied
	item.AlreadyGranted = !applied && grant != nil
	if membership == nil {
		item.Error = "发放后未返回会员记录"
		return
	}
	if membership.CurrentPlanCode != nil {
		item.ActualPlanCode = *membership.CurrentPlanCode
	}
	autoRenew := membership.AutoRenew
	item.ActualAutoRenew = &autoRenew
	item.ActualExpiresAt = membership.ExpiresAt
}

func sourceKey(campaignID, userID string) string {
	return "paid-membership-campaign:" + strings.TrimSpace(campaignID) + ":" + strings.TrimSpace(userID)
}

func nicknameOf(user *membershiprepo.User) string {
	if user != nil && user.Nickname != nil && strings.TrimSpace(*user.Nickname) != "" {
		return strings.TrimSpace(*user.Nickname)
	}
	return "未设置昵称"
}

func databaseTarget(host, name, schema string) string {
	return strings.TrimSpace(host) + "/" + strings.TrimSpace(name) + "/" + strings.TrimSpace(schema)
}

func mode(apply bool) string {
	if apply {
		return "apply"
	}
	return "dry-run"
}

func writeReport(report campaignReport, requestedPath string) {
	path := strings.TrimSpace(requestedPath)
	if path == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("%s-%s.json", report.CampaignID, report.GeneratedAt.Format("20060102-150405")))
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		log.Fatalf("序列化活动审计报告失败: %v", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		log.Fatalf("写入活动审计报告失败: %v", err)
	}
	log.Printf("活动审计报告：%s", path)
}
