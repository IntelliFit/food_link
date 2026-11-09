package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

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

func TestPendingShowsOnlyTheNewestFreshNoticeOncePerDay(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testdb.New(t)
	require.NoError(t, db.Exec("CREATE TABLE weapp_user (id uuid PRIMARY KEY)").Error)
	user := uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO weapp_user VALUES (?)", user).Error)
	require.NoError(t, migration.MigrateProductUpdates(context.Background(), db, "public"))
	h := New(service.New(repo.New(db)))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", c.GetHeader("X-Test-User"))
		c.Set("admin_username", "test-admin")
	})
	r.GET("/public", h.Public)
	r.GET("/pending", h.Pending)
	r.POST("/draft", h.Save)
	r.POST("/change/:id/:action", h.Transition)
	r.POST("/ack/:id", h.Acknowledge)
	call := func(method, path, who, body string) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User", who)
		r.ServeHTTP(w, req)
		require.Equal(t, 200, w.Code, w.Body.String())
		var result map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		return result
	}
	publish := func(title, minVersion string, age time.Duration) string {
		t.Helper()
		body := fmt.Sprintf(`{"title":%q,"content":"正文","min_version":%q}`, title, minVersion)
		id := call("POST", "/draft", "", body)["data"].(map[string]any)["item"].(map[string]any)["id"].(string)
		call("POST", "/change/"+id+"/publish", "", "{}")
		require.NoError(t, db.Exec("UPDATE product_updates SET published_at = ? WHERE id = ?", time.Now().Add(-age), id).Error)
		return id
	}
	titles := func(path string) []string {
		t.Helper()
		out := []string{}
		for _, item := range call("GET", path, user, "")["data"].(map[string]any)["items"].([]any) {
			out = append(out, item.(map[string]any)["title"].(string))
		}
		return out
	}
	const pending, public = "/pending?app_version=4.6.16", "/public?app_version=4.6.16"
	ageAcks := func(age time.Duration) {
		t.Helper()
		require.NoError(t, db.Exec("UPDATE product_update_acknowledgements SET acknowledged_at = ?", time.Now().Add(-age)).Error)
	}

	// Notices nobody saw within a day are dropped, even though no receipt exists.
	publish("三天前", "4.6.12", 72*time.Hour)
	stale := publish("超过一天", "4.6.12", 25*time.Hour)
	require.Empty(t, titles(pending))
	require.Empty(t, titles(public))

	// Of several fresh notices only the newest is shown, whatever the creation order.
	older := publish("较早", "4.6.12", 3*time.Hour)
	newest := publish("最新", "4.6.12", time.Hour)
	require.Equal(t, []string{"最新"}, titles(pending))
	require.Equal(t, []string{"最新"}, titles(public))

	// A newest notice this client version cannot see falls back to the next fresh one.
	future := publish("新版本才有", "9.9.9", time.Minute)
	require.Equal(t, []string{"最新"}, titles(pending))
	call("POST", "/change/"+future+"/withdraw", "", "{}")

	// Confirming one notice ends the day for this user, though another is still unread.
	call("POST", "/ack/"+newest, user, `{"app_version":"4.6.16"}`)
	require.Empty(t, titles(pending))

	// The next day the remaining fresh notice may appear, once.
	ageAcks(25 * time.Hour)
	require.Equal(t, []string{"较早"}, titles(pending))
	call("POST", "/ack/"+older, user, `{"app_version":"4.6.16"}`)
	require.Empty(t, titles(pending))

	// A receipt for an older notice earlier today also uses up today's slot.
	ageAcks(25 * time.Hour)
	require.Empty(t, titles(pending))
	publish("今天新发", "4.6.12", time.Minute)
	require.Equal(t, []string{"今天新发"}, titles(pending))
	call("POST", "/ack/"+stale, user, `{"app_version":"4.6.16"}`)
	require.Empty(t, titles(pending))
}
