package service

import (
	"context"
	"food_link/backend/internal/auth/repo"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestAccountDeletionLoginKeepsBothWechatPlatformsRestricted(t *testing.T) {
	defer testdb.Stop()
	ctx := context.Background()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.UserDO{}))
	users := repo.NewUserRepo(db)
	union := "account-deletion-test-union"
	user := &repo.User{OpenID: "app-wx:pending-account", UnionID: &union, AppUnionID: &union, Nickname: "注销流程测试"}
	require.NoError(t, users.Create(ctx, user))
	require.NoError(t, migration.MigrateAccountDeletion(ctx, db, "public"))
	_, err := users.RequestDeletion(ctx, user.ID, 7, time.Now())
	require.NoError(t, err)
	cfg := &config.Config{App: config.AppConfig{Env: "development"}, JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 7200}}
	jwt := NewJWTService("deletion-login-test-only", 3600, 7200)
	jwt.ConfigureAccountAccess(users.CheckAccountAccess)
	svc := NewLoginService(cfg, users, jwt)
	mini, err := svc.findOrCreateWechatUser(ctx, "new-mini-openid", union, "", "", "wechat_miniprogram")
	require.NoError(t, err)
	require.Equal(t, user.ID, mini.ID)
	app, err := svc.findOrCreateAppWechatUser(ctx, "new-app-openid", union, "")
	require.NoError(t, err)
	require.Equal(t, user.ID, app.ID)
	// No trial table exists: pending login must not try to grant/modify rights.
	output, err := svc.Login(ctx, LoginInput{TestOpenID: user.OpenID, PhoneCode: "must-not-be-exchanged"})
	require.NoError(t, err)
	require.Equal(t, user.ID, output.UserID)
	claims, err := jwt.Parse(output.AccessToken)
	require.NoError(t, err)
	require.NoError(t, jwt.CheckAccountAccess(ctx, claims, "/api/user/account/deletion", "GET"))
	require.ErrorIs(t, jwt.CheckAccountAccess(ctx, claims, "/api/user/profile", "GET"), repo.ErrAccountDeleting)
	d, err := users.DeletionStatus(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, "pending", d.State)
	stored, err := users.FindByID(ctx, user.ID)
	require.NoError(t, err)
	require.Nil(t, stored.AppOpenID, "login must not change identity bindings during suspension")
}
