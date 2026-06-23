package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type User struct {
	ID                             string         `gorm:"column:id"`
	OpenID                         string         `gorm:"column:openid"`
	UnionID                        *string        `gorm:"column:unionid"`
	AppOpenID                      *string        `gorm:"column:app_openid"`
	AppUnionID                     *string        `gorm:"column:app_unionid"`
	Username                       *string        `gorm:"column:username"`
	PasswordHash                   *string        `gorm:"column:password_hash"`
	PasswordSetAt                  *time.Time     `gorm:"column:password_set_at"`
	LastLoginMethod                *string        `gorm:"column:last_login_method"`
	LastLoginAt                    *time.Time     `gorm:"column:last_login_at"`
	Nickname                       string         `gorm:"column:nickname"`
	Avatar                         string         `gorm:"column:avatar"`
	Telephone                      *string        `gorm:"column:telephone"`
	DietGoal                       *string        `gorm:"column:diet_goal"`
	HealthCondition                map[string]any `gorm:"column:health_condition;serializer:json"`
	CreatedAt                      *time.Time     `gorm:"column:create_time"`
	OnboardingCompleted            *bool          `gorm:"column:onboarding_completed"`
	Height                         *float64       `gorm:"column:height"`
	Weight                         *float64       `gorm:"column:weight"`
	Birthday                       *string        `gorm:"column:birthday"`
	Gender                         *string        `gorm:"column:gender"`
	ActivityLevel                  *string        `gorm:"column:activity_level"`
	BMR                            *float64       `gorm:"column:bmr"`
	TDEE                           *float64       `gorm:"column:tdee"`
	ExecutionMode                  *string        `gorm:"column:execution_mode"`
	ModeSetBy                      *string        `gorm:"column:mode_set_by"`
	ModeSetAt                      *time.Time     `gorm:"column:mode_set_at"`
	ModeReason                     *string        `gorm:"column:mode_reason"`
	ModeCommitmentDays             *int           `gorm:"column:mode_commitment_days"`
	ModeSwitchCount30d             *int           `gorm:"column:mode_switch_count_30d"`
	Searchable                     *bool          `gorm:"column:searchable"`
	PublicRecords                  *bool          `gorm:"column:public_records"`
	LastSeenAnalyzeHistory         *time.Time     `gorm:"column:last_seen_analyze_history_at"`
	RegistrationInviteCode         *string        `gorm:"column:registration_invite_code"`
	ReferredByUserID               *string        `gorm:"column:referred_by_user_id"`
	PointsBalance                  *float64       `gorm:"column:points_balance"`
	HealthDisclaimerAcknowledgedAt *time.Time     `gorm:"column:health_disclaimer_acknowledged_at"`
	Motto                          string         `gorm:"column:motto"`
	CoverImage                     string         `gorm:"column:cover_image"`
}

func (User) TableName() string { return "weapp_user" }

type UserTrialEntitlement struct {
	ID                string     `gorm:"column:id"`
	FirstUserID       *string    `gorm:"column:first_user_id"`
	OpenID            string     `gorm:"column:openid"`
	UnionID           *string    `gorm:"column:unionid"`
	FirstRegisteredAt *time.Time `gorm:"column:first_registered_at"`
	EarlyUserRank     *int       `gorm:"column:early_user_rank"`
	TrialDaysTotal    int        `gorm:"column:trial_days_total"`
	TrialPolicy       string     `gorm:"column:trial_policy"`
	CreatedAt         *time.Time `gorm:"column:created_at"`
	UpdatedAt         *time.Time `gorm:"column:updated_at"`
}

func (UserTrialEntitlement) TableName() string { return "user_trial_entitlements" }

type UserRepo struct {
	db *gorm.DB
}

func NewUserRepo(db *gorm.DB) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) DB() *gorm.DB {
	if r == nil {
		return nil
	}
	return r.db
}

func (r *UserRepo) HasUserColumn(column string) bool {
	if r == nil || r.db == nil {
		return false
	}
	return r.db.Migrator().HasColumn(&User{}, column)
}

func (r *UserRepo) FindByOpenID(ctx context.Context, openID string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("openid = ?", openID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindByAppOpenID(ctx context.Context, appOpenID string) (*User, error) {
	appOpenID = strings.TrimSpace(appOpenID)
	if appOpenID == "" {
		return nil, nil
	}
	var user User
	err := r.db.WithContext(ctx).Where("app_openid = ?", appOpenID).First(&user).Error
	if isUndefinedColumnError(err) {
		return r.FindByOpenID(ctx, "app-wx:"+appOpenID)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindByUnionID(ctx context.Context, unionID string) (*User, error) {
	unionID = strings.TrimSpace(unionID)
	if unionID == "" {
		return nil, nil
	}
	var user User
	err := r.db.WithContext(ctx).Where("unionid = ? OR app_unionid = ?", unionID, unionID).First(&user).Error
	if isUndefinedColumnError(err) {
		err = r.db.WithContext(ctx).Where("unionid = ?", unionID).First(&user).Error
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*User, error) {
	username = normalizeUsername(username)
	if username == "" {
		return nil, nil
	}
	var user User
	err := r.db.WithContext(ctx).Where("LOWER(username) = ?", username).First(&user).Error
	if isUndefinedColumnError(err) {
		return r.FindByOpenID(ctx, "app-pwd:"+username)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindByTelephone(ctx context.Context, phone string) (*User, error) {
	phone = normalizePhone(phone)
	if phone == "" {
		return nil, nil
	}
	var users []User
	err := r.db.WithContext(ctx).
		Where("telephone = ? OR telephone = ?", phone, "+86"+phone).
		Limit(2).
		Find(&users).Error
	if isUndefinedColumnError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return nil, nil
	}
	if len(users) > 1 {
		return nil, fmt.Errorf("手机号绑定了多个账号，请联系客服处理")
	}
	return &users[0], nil
}

func (r *UserRepo) FindByID(ctx context.Context, userID string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindTrialEntitlementByIdentity(ctx context.Context, openID, unionID string) (*UserTrialEntitlement, error) {
	unionID = strings.TrimSpace(unionID)
	openID = strings.TrimSpace(openID)
	if unionID != "" {
		var ent UserTrialEntitlement
		err := r.db.WithContext(ctx).Where("unionid = ?", unionID).First(&ent).Error
		if err == nil {
			return &ent, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	if openID == "" {
		return nil, nil
	}
	var ent UserTrialEntitlement
	err := r.db.WithContext(ctx).Where("openid = ?", openID).First(&ent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &ent, err
}

func (r *UserRepo) DeleteByID(ctx context.Context, userID string) error {
	result := r.db.WithContext(ctx).Where("id = ?", userID).Delete(&User{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *UserRepo) Create(ctx context.Context, user *User) error {
	if user.ID == "" {
		user.ID = uuid.New().String()
	}
	db := r.db.WithContext(ctx)
	if omit := r.missingUserFieldNames(appAuthColumnFieldNames); len(omit) > 0 {
		db = db.Omit(omit...)
	}
	return db.Create(user).Error
}

func (r *UserRepo) CreateTrialEntitlement(ctx context.Context, ent *UserTrialEntitlement) error {
	if ent.ID == "" {
		ent.ID = uuid.New().String()
	}
	now := time.Now()
	if ent.CreatedAt == nil {
		ent.CreatedAt = &now
	}
	if ent.UpdatedAt == nil {
		ent.UpdatedAt = &now
	}
	return r.db.WithContext(ctx).Create(ent).Error
}

func (r *UserRepo) UpdateFields(ctx context.Context, userID string, updates map[string]any) (*User, error) {
	updates = r.filterExistingUserColumns(updates)
	updates = normalizeUserJSONUpdates(updates)
	if len(updates) == 0 {
		return r.FindByID(ctx, userID)
	}
	if err := r.db.WithContext(ctx).Model(&User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.FindByID(ctx, userID)
}

func normalizeUserJSONUpdates(updates map[string]any) map[string]any {
	if len(updates) == 0 {
		return updates
	}
	value, ok := updates["health_condition"]
	if !ok || value == nil {
		return updates
	}
	switch typed := value.(type) {
	case datatypes.JSONMap:
		return updates
	case map[string]any:
		updates["health_condition"] = datatypes.JSONMap(typed)
	}
	return updates
}

func (r *UserRepo) UpdateTrialEntitlement(ctx context.Context, id string, updates map[string]any) (*UserTrialEntitlement, error) {
	if len(updates) > 0 {
		if _, ok := updates["updated_at"]; !ok {
			updates["updated_at"] = time.Now()
		}
		if err := r.db.WithContext(ctx).Model(&UserTrialEntitlement{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	var ent UserTrialEntitlement
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&ent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &ent, err
}

func (r *UserRepo) ExchangeCode(ctx context.Context, appID, secret, code string) (string, string, error) {
	if code == "" {
		return "", "", fmt.Errorf("code 不能为空")
	}
	type wxResp struct {
		OpenID  string `json:"openid"`
		UnionID string `json:"unionid"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	var resp wxResp
	if err := simpleJSONGet(ctx, "https://api.weixin.qq.com/sns/jscode2session", map[string]string{
		"appid":      appID,
		"secret":     secret,
		"js_code":    code,
		"grant_type": "authorization_code",
	}, &resp); err != nil {
		return "", "", err
	}
	if resp.ErrCode != 0 {
		return "", "", fmt.Errorf("微信登录失败: %s (%d)", resp.ErrMsg, resp.ErrCode)
	}
	return resp.OpenID, resp.UnionID, nil
}

func (r *UserRepo) ExchangeAppCode(ctx context.Context, appID, secret, code string) (string, string, error) {
	if code == "" {
		return "", "", fmt.Errorf("code 不能为空")
	}
	type wxResp struct {
		OpenID      string `json:"openid"`
		UnionID     string `json:"unionid"`
		AccessToken string `json:"access_token"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	var resp wxResp
	if err := simpleJSONGet(ctx, "https://api.weixin.qq.com/sns/oauth2/access_token", map[string]string{
		"appid":      appID,
		"secret":     secret,
		"code":       code,
		"grant_type": "authorization_code",
	}, &resp); err != nil {
		return "", "", err
	}
	if resp.ErrCode != 0 {
		return "", "", fmt.Errorf("微信 App 登录失败: %s (%d)", resp.ErrMsg, resp.ErrCode)
	}
	return resp.OpenID, resp.UnionID, nil
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func normalizePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	phone = strings.TrimPrefix(phone, "+")
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if strings.HasPrefix(out, "86") && len(out) == 13 {
		out = out[2:]
	}
	return out
}

var appAuthColumnFieldNames = map[string]string{
	"app_openid":        "AppOpenID",
	"app_unionid":       "AppUnionID",
	"username":          "Username",
	"telephone":         "Telephone",
	"password_hash":     "PasswordHash",
	"password_set_at":   "PasswordSetAt",
	"last_login_method": "LastLoginMethod",
	"last_login_at":     "LastLoginAt",
}

func (r *UserRepo) missingUserFieldNames(columns map[string]string) []string {
	if r == nil || r.db == nil {
		return nil
	}
	missing := make([]string, 0)
	for column, field := range columns {
		if !r.HasUserColumn(column) {
			missing = append(missing, field)
		}
	}
	return missing
}

func (r *UserRepo) filterExistingUserColumns(updates map[string]any) map[string]any {
	if len(updates) == 0 || r == nil || r.db == nil {
		return updates
	}
	filtered := make(map[string]any, len(updates))
	for key, value := range updates {
		if _, appAuthColumn := appAuthColumnFieldNames[key]; appAuthColumn && !r.HasUserColumn(key) {
			continue
		}
		filtered[key] = value
	}
	return filtered
}

func isUndefinedColumnError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 42703") || strings.Contains(strings.ToLower(err.Error()), "no such column")
}

func (r *UserRepo) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Update("last_seen_analyze_history_at", time.Now()).Error
}

func (r *UserRepo) UpdateHealthDisclaimerAcknowledged(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Update("health_disclaimer_acknowledged_at", time.Now()).Error
}

func (r *UserRepo) CountFoodRecordDays(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT DATE(record_time))
		FROM user_food_records
		WHERE user_id = ?
	`, userID).Scan(&count).Error
	return count, err
}

func (r *UserRepo) GetFirstMembershipTrialBatchRank(ctx context.Context, userID string, limit int) (int, error) {
	if strings.TrimSpace(userID) == "" {
		return 0, nil
	}
	query := r.db.WithContext(ctx).
		Table("weapp_user").
		Select("id").
		Order("create_time IS NULL ASC").
		Order("create_time ASC").
		Order("id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	var rows []struct {
		ID string `gorm:"column:id"`
	}
	if err := query.Find(&rows).Error; err != nil {
		return 0, err
	}
	for index, row := range rows {
		if row.ID == userID {
			return index + 1, nil
		}
	}
	return 0, nil
}

func (r *UserRepo) FindByRegistrationInviteCode(ctx context.Context, code string) (*User, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, nil
	}
	var user User
	err := r.db.WithContext(ctx).Where("registration_invite_code = ?", code).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) ResolveUserByInviteCode(ctx context.Context, code string) (*User, error) {
	code = strings.ToLower(strings.TrimSpace(code))
	if len(code) < 3 {
		return nil, nil
	}
	var users []User
	err := r.db.WithContext(ctx).
		Where("LOWER(REPLACE(id, '-', '')) LIKE ?", code+"%").
		Limit(2).
		Find(&users).Error
	if err != nil || len(users) == 0 {
		return nil, err
	}
	if len(users) > 1 {
		return nil, fmt.Errorf("invite code is ambiguous")
	}
	return &users[0], nil
}

func (r *UserRepo) CreateInviteReferralBinding(ctx context.Context, inviterUserID, inviteeUserID, inviteCode string) error {
	if inviterUserID == "" || inviteeUserID == "" || inviterUserID == inviteeUserID {
		return nil
	}
	now := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60))
	row := map[string]any{
		"id":                uuid.New().String(),
		"inviter_user_id":   inviterUserID,
		"invitee_user_id":   inviteeUserID,
		"invite_code":       strings.ToUpper(strings.TrimSpace(inviteCode)),
		"status":            "pending_qualified",
		"reward_start_date": now.Format("2006-01-02"),
		"reward_end_date":   now.AddDate(0, 0, 7).Format("2006-01-02"),
		"created_at":        time.Now(),
		"updated_at":        time.Now(),
	}
	return r.db.WithContext(ctx).Table("user_invite_referrals").Create(row).Error
}
