package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authmw "food_link/backend/internal/auth"
	authrepo "food_link/backend/internal/auth/repo"
	openplatformdomain "food_link/backend/internal/openplatform/domain"
	openhandler "food_link/backend/internal/openplatform/handler"
	openrepo "food_link/backend/internal/openplatform/repo"
	openservice "food_link/backend/internal/openplatform/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeveloperConsoleCreatesListsAndRevokesKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &openplatformdomain.App{}, &openplatformdomain.APIKey{}, &openplatformdomain.Request{}, &openplatformdomain.UsageLedger{}, &openplatformdomain.CreditPackage{}, &openplatformdomain.PaymentOrder{}))
	platform := openservice.New(openrepo.New(db), nil, nil, nil)
	engine := gin.New()
	requireJWT := func(c *gin.Context) { c.Set(authmw.ContextUserIDKey, "owner-http"); c.Next() }
	openhandler.New(platform).RegisterDeveloperRoutes(engine, requireJWT)

	create := httptest.NewRequest(http.MethodPost, "/api/developer/apps", bytes.NewBufferString(`{"name":"HTTP 测试 Agent"}`))
	create.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, create)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created struct {
		Data openservice.KeyMaterial `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	require.NotEmpty(t, created.Data.Secret)
	require.NotEmpty(t, created.Data.App.ID)

	list := httptest.NewRequest(http.MethodGet, "/api/developer/apps", nil)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, list)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "secret_hash")
	require.NotContains(t, w.Body.String(), created.Data.Secret)

	revoke := httptest.NewRequest(http.MethodDelete, "/api/developer/apps/"+created.Data.App.ID+"/keys/"+created.Data.APIKey.ID, nil)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, revoke)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	_, err = platform.Authenticate(context.Background(), created.Data.Secret)
	require.Error(t, err)
}
