package domain

import "time"

type PaymentTestSettings struct {
	Enabled   bool       `json:"enabled"`
	UpdatedBy *string    `json:"updated_by,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type PaymentTestPlan struct {
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Description    *string  `json:"description,omitempty"`
	Amount         float64  `json:"amount"`
	DurationMonths int      `json:"duration_months"`
	IsActive       bool     `json:"is_active"`
	IsVisible      bool     `json:"is_visible"`
	IsTestPlan     bool     `json:"is_test_plan"`
	Tier           *string  `json:"tier,omitempty"`
	Period         *string  `json:"period,omitempty"`
	DailyCredits   int      `json:"daily_credits"`
	OriginalAmount *float64 `json:"original_amount,omitempty"`
	SortOrder      int      `json:"sort_order"`
}

type PaymentTestUser struct {
	ID                        string     `json:"id"`
	UserID                    string     `json:"user_id"`
	Nickname                  string     `json:"nickname"`
	Avatar                    string     `json:"avatar"`
	Telephone                 string     `json:"telephone"`
	OpenID                    string     `json:"openid"`
	AppOpenID                 string     `json:"app_openid"`
	Note                      string     `json:"note"`
	CreatedBy                 string     `json:"created_by"`
	CurrentMembershipStatus   string     `json:"current_membership_status"`
	CurrentPlanCode           string     `json:"current_plan_code"`
	CurrentExpiresAt          *time.Time `json:"current_expires_at,omitempty"`
	CurrentDailyCredits       int        `json:"current_daily_credits"`
	MembershipBackupAvailable bool       `json:"membership_backup_available"`
	BackupPlanCode            string     `json:"backup_plan_code"`
	BackupStatus              string     `json:"backup_status"`
	BackupExpiresAt           *time.Time `json:"backup_expires_at,omitempty"`
	BackupDailyCredits        int        `json:"backup_daily_credits"`
	MembershipSnapshotTakenAt *time.Time `json:"membership_snapshot_taken_at,omitempty"`
	MembershipCancelledAt     *time.Time `json:"membership_cancelled_at,omitempty"`
	MembershipCancelledBy     string     `json:"membership_cancelled_by,omitempty"`
	MembershipRestoredAt      *time.Time `json:"membership_restored_at,omitempty"`
	MembershipRestoredBy      string     `json:"membership_restored_by,omitempty"`
	CreatedAt                 *time.Time `json:"created_at,omitempty"`
	UpdatedAt                 *time.Time `json:"updated_at,omitempty"`
}

type PaymentTestUserSearchResult struct {
	UserID    string     `json:"user_id"`
	Nickname  string     `json:"nickname"`
	Avatar    string     `json:"avatar"`
	Telephone string     `json:"telephone"`
	OpenID    string     `json:"openid"`
	AppOpenID string     `json:"app_openid"`
	CreatedAt *time.Time `json:"created_at,omitempty"`
	IsAdded   bool       `json:"is_added"`
}

type PaymentTestSummary struct {
	Settings PaymentTestSettings `json:"settings"`
	Plan     *PaymentTestPlan    `json:"plan"`
	Users    []PaymentTestUser   `json:"users"`
}
