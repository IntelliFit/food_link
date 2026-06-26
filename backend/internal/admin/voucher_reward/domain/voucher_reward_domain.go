package domain

import "time"

type UserSearchResult struct {
	UserID    string     `json:"user_id"`
	Nickname  string     `json:"nickname"`
	Avatar    string     `json:"avatar"`
	Telephone string     `json:"telephone"`
	OpenID    string     `json:"open_id"`
	AppOpenID string     `json:"app_open_id"`
	CreatedAt *time.Time `json:"created_at"`
}

type UserSummary struct {
	UserID                 string     `json:"user_id"`
	Nickname               string     `json:"nickname"`
	Telephone              string     `json:"telephone"`
	Avatar                 string     `json:"avatar"`
	CreatedAt              *time.Time `json:"created_at"`
	EarnedCreditsBalance   int        `json:"earned_credits_balance"`
	IsPro                  bool       `json:"is_pro"`
	CurrentPlanCode        string     `json:"current_plan_code"`
	DailyCredits           int        `json:"daily_credits"`
	MembershipExpiresAt    *time.Time `json:"membership_expires_at"`
	MembershipStatus       string     `json:"membership_status"`
}

type IssuePointsVoucherInput struct {
	Points int    `json:"points"`
	Note   string `json:"note"`
}

type IssuePointsVoucherResult struct {
	VoucherID string `json:"voucher_id"`
}
