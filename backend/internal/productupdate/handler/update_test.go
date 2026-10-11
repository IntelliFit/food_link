package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"

	"food_link/backend/internal/migration"
	"food_link/backend/internal/productupdate/domain"
	"food_link/backend/internal/productupdate/repo"
	"food_link/backend/internal/productupdate/service"
	"food_link/backend/pkg/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if err := testdb.Stop(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if code == 0 {
			code = 1
		}
	}
	os.Exit(code)
}

func TestLifecycleMigrationAndAcknowledgements(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testdb.New(t)
	// Minimal unrelated user table proves the targeted migration avoids changing it.
	require.NoError(t, db.Exec("CREATE TABLE weapp_user (id uuid PRIMARY KEY, marker text NOT NULL)").Error)
	userA, userB := uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO weapp_user VALUES (?, 'unchanged'), (?, 'unchanged')", userA, userB).Error)
	ctx := context.Background()
	require.NoError(t, migration.MigrateProductUpdates(ctx, db, "public"))
	require.NoError(t, migration.MigrateProductUpdates(ctx, db, "public"))
	h := New(service.New(repo.New(db)))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", c.GetHeader("X-Test-User"))
		c.Set("admin_username", "test-admin")
	})
	r.GET("/public", h.Public)
	r.GET("/pending", h.Pending)
	r.GET("/admin", h.AdminList)
	r.POST("/draft", h.Save)
	r.PATCH("/draft/:id", h.Save)
	r.POST("/change/:id/:action", h.Transition)
	r.POST("/ack/:id", h.Acknowledge)
	call := func(method, path, user, body string, status int) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User", user)
		r.ServeHTTP(w, req)
		require.Equal(t, status, w.Code, w.Body.String())
		var result map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		return result
	}
	list := func(path, user string) []any {
		return call("GET", path, user, "", 200)["data"].(map[string]any)["items"].([]any)
	}
	input := `{"title":"新功能","content":"现在可以邀请好友一起吃饭","min_version":"4.6.12"}`
	id := call("POST", "/draft", "", input, 200)["data"].(map[string]any)["item"].(map[string]any)["id"].(string)
	require.Empty(t, list("/pending?app_version=4.6.12", userA))
	call("POST", "/ack/"+id, userA, `{"app_version":"4.6.12"}`, 409)
	call("POST", "/change/"+id+"/publish", "", "{}", 200)
	require.Empty(t, list("/pending?app_version=4.6.11", userA))
	require.Len(t, list("/pending?app_version=4.6.12", userA), 1)
	require.Len(t, list("/public?app_version=4.6.12", ""), 1)
	call("PATCH", "/draft/"+id, "", input, 409)
	call("POST", "/ack/"+id, userA, `{"app_version":"4.6.11"}`, 409)
	call("POST", "/ack/"+id, "", `{"app_version":"4.6.12"}`, 401)
	call("POST", "/ack/"+id, userA, `{"app_version":"4.6.12"}`, 200)
	call("POST", "/ack/"+id, userA, `{"app_version":"4.6.12"}`, 200)
	require.Empty(t, list("/pending?app_version=4.6.12", userA))
	require.Len(t, list("/pending?app_version=4.6.12", userB), 1)
	require.Equal(t, float64(1), list("/admin", "")[0].(map[string]any)["acknowledged_count"])
	call("POST", "/change/"+id+"/withdraw", "", "{}", 200)
	require.Empty(t, list("/pending?app_version=4.6.12", userB))
	call("POST", "/ack/"+id, userB, `{"app_version":"4.6.12"}`, 409)
	call("POST", "/change/"+id+"/publish", "", "{}", 409)
	var receipts int64
	require.NoError(t, db.Table("product_update_acknowledgements").Count(&receipts).Error)
	require.EqualValues(t, 1, receipts)
	var userMarker string
	require.NoError(t, db.Raw("SELECT marker FROM weapp_user WHERE id = ?", userA).Scan(&userMarker).Error)
	require.Equal(t, "unchanged", userMarker)
	var item domain.Update
	require.NoError(t, db.First(&item, "id = ?", id).Error)
	require.Equal(t, "withdrawn", item.Status)
	call("POST", "/draft", "", `{"title":"","content":"x","min_version":"4.6.12"}`, 400)
	call("GET", "/pending?app_version=bad", userA, "", 400)
}
