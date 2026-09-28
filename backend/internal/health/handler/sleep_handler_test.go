package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/health/repo"
	"food_link/backend/internal/health/service"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/testdb"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSleepRecordContractAndMigration(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec("CREATE TABLE weapp_user (id uuid PRIMARY KEY)").Error)
	for i := 0; i < 2; i++ {
		require.NoError(t, migration.MigrateSleepRecords(context.Background(), db, "public"))
	}
	a, b := "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
	require.NoError(t, db.Exec("INSERT INTO weapp_user(id) VALUES (?),(?)", a, b).Error)
	h := NewSleepHandler(service.NewSleepService(repo.NewSleepRepo(db)))
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(authmw.ContextUserIDKey, c.GetHeader("X-Test-User")) })
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		r.Handle(method, "/api/sleep-records/:date", h.Handle)
	}
	request := func(method, user, body string, status int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/api/sleep-records/2026-09-26", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User", user)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		require.Equal(t, status, w.Code, w.Body.String())
		var out map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		return out
	}
	body := `{"bedtime":"2026-09-25T23:00:00+08:00","wake_time":"2026-09-26T07:00:00+08:00","quality":"good","note":"手动补记"}`
	request("PUT", "", body, 401)
	request("PUT", a, `{"bedtime":"bad"}`, 400)
	first := request("PUT", a, body, 200)["data"].(map[string]any)
	require.EqualValues(t, 480, first["duration_minutes"])
	updated := request("PUT", a, `{"bedtime":"2026-09-26T01:00:00+08:00","wake_time":"2026-09-26T08:00:00+08:00","quality":"poor","note":"修改备注"}`, 200)["data"].(map[string]any)
	require.Equal(t, first["id"], updated["id"])
	require.EqualValues(t, 420, updated["duration_minutes"])
	require.Nil(t, request("GET", b, "", 200)["data"])
	request("DELETE", b, "", 200)
	require.Equal(t, "修改备注", request("GET", a, "", 200)["data"].(map[string]any)["note"])
	var count int64
	require.NoError(t, db.Table("user_sleep_records").Count(&count).Error)
	require.EqualValues(t, 1, count)
	request("DELETE", a, "", 200)
	require.Nil(t, request("GET", a, "", 200)["data"])
	request("PUT", a, body, 200)
	require.NoError(t, db.Exec("DELETE FROM weapp_user WHERE id = ?", a).Error)
	require.NoError(t, db.Table("user_sleep_records").Count(&count).Error)
	require.Zero(t, count)
}
