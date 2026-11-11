package handler

import (
	"bytes"
	"context"
	"encoding/json"
	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/auth/repo"
	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/internal/migration"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAccountDeletionHTTPFlow(t *testing.T) {
	defer testdb.Stop()
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user(id uuid PRIMARY KEY,openid text,nickname text,searchable boolean,public_records boolean,friends_can_view_records boolean,public_favorite_recipes boolean)`).Error)
	id := uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO weapp_user VALUES(?,?,'name',true,true,true,true)", id, "test-openid").Error)
	require.NoError(t, migration.MigrateAccountDeletion(context.Background(), db, "public"))
	users := repo.NewUserRepo(db)
	jwt := authservice.NewJWTService("account-deletion-test-only", 3600, 7200)
	jwt.ConfigureAccountAccess(users.CheckAccountAccess)
	h := NewAccountDeletionHandler(userservice.NewAccountDeletionService(users, nil, 0), jwt)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	guard := authmw.RequireJWT(jwt)
	r.DELETE("/api/user/account", guard, h.Request)
	r.GET("/api/user/account/deletion", guard, h.Status)
	r.POST("/api/user/account/deletion/cancel", guard, h.Cancel)
	r.GET("/api/private", guard, func(c *gin.Context) { c.JSON(200, gin.H{"private": true}) })
	call := func(method, path, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	old, err := jwt.IssueAccess(id, "test-openid", "")
	require.NoError(t, err)
	require.Equal(t, 400, call("DELETE", "/api/user/account", `{"confirmation":"wrong"}`, old).Code)
	require.Equal(t, 400, call("DELETE", "/api/user/account", `{"confirmation":"注销账号","cooling_off_days":30}`, old).Code)
	requested := call("DELETE", "/api/user/account", `{"confirmation":"注销账号"}`, old)
	require.Equal(t, 200, requested.Code, requested.Body.String())
	var output struct {
		Data struct {
			AccessToken string                            `json:"access_token"`
			Status      userservice.AccountDeletionStatus `json:"status"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(requested.Body.Bytes(), &output))
	limited := output.Data.AccessToken
	require.True(t, output.Data.Status.CanCancel)
	require.Equal(t, http.StatusUnauthorized, call("GET", "/api/private", "", old).Code)
	require.Equal(t, http.StatusForbidden, call("GET", "/api/private", "", limited).Code)
	require.Equal(t, 200, call("GET", "/api/user/account/deletion", "", limited).Code)
	// A fresh platform login only grants access to status; it never cancels.
	fresh, _ := jwt.IssueAccess(id, "test-openid", "")
	require.Equal(t, 403, call("GET", "/api/private", "", fresh).Code)
	d, err := users.DeletionStatus(context.Background(), id)
	require.NoError(t, err)
	require.Equal(t, "pending", d.State)
	require.Equal(t, 400, call("POST", "/api/user/account/deletion/cancel", `{}`, fresh).Code)
	require.Equal(t, 200, call("POST", "/api/user/account/deletion/cancel", `{"confirmation":"撤销注销"}`, fresh).Code)
	require.Equal(t, 401, call("GET", "/api/private", "", limited).Code)
	require.Equal(t, 401, call("GET", "/api/private", "", old).Code)
	restored, _ := jwt.IssueAccess(id, "test-openid", "")
	require.Equal(t, 200, call("GET", "/api/private", "", restored).Code)
	refresh, _ := jwt.IssueRefresh(id, "test-openid")
	require.Equal(t, 401, call("GET", "/api/private", "", refresh).Code)
}
