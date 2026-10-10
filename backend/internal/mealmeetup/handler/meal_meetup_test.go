package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/internal/mealmeetup/domain"
	"food_link/backend/internal/mealmeetup/repo"
	"food_link/backend/internal/mealmeetup/service"
	messagerepo "food_link/backend/internal/message/repo"
	messageservice "food_link/backend/internal/message/service"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/storage"
	"food_link/backend/pkg/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type auditStub struct{ reject bool }

func (a *auditStub) CheckPublication(context.Context, string, int, map[string]any, *storage.Client) error {
	if a.reject {
		return contentsecurity.ErrRejected
	}
	return nil
}
func TestMain(m *testing.M) {
	code := m.Run()
	if err := testdb.Stop(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		code = 1
	}
	root := os.Getenv("FOODLINK_TEST_TMPDIR")
	if filepath.IsAbs(root) && strings.HasPrefix(filepath.Base(root), "meal-meetup-implementation-") {
		matches, _ := filepath.Glob(filepath.Join(root, "embedded-postgres-go", fmt.Sprintf("pg-%d-*", os.Getpid())))
		for _, path := range matches {
			rel, err := filepath.Rel(root, path)
			if err == nil && !strings.HasPrefix(rel, "..") {
				_ = os.RemoveAll(path)
			}
		}
	}
	os.Exit(code)
}
func TestMealMeetupHTTPAndStateBoundaries(t *testing.T) {
	db := testdb.New(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.Exec("CREATE TABLE weapp_user (id uuid PRIMARY KEY, nickname text, avatar text)").Error)
	require.NoError(t, db.AutoMigrate(&migrationdo.UserBlockDO{}, &migrationdo.PrivateMessageDO{}))
	ctx := context.Background()
	require.NoError(t, migration.MigrateMealMeetups(ctx, db, "public"))
	require.NoError(t, migration.MigrateMealMeetups(ctx, db, "public"))
	users := []string{}
	for i := 0; i < 9; i++ {
		id := uuid.NewString()
		users = append(users, id)
		require.NoError(t, db.Exec("INSERT INTO weapp_user(id,nickname,avatar) VALUES (?, ?, '')", id, fmt.Sprintf("测试饭搭子%d", i)).Error)
	}
	audit := &auditStub{}
	svc := service.New(repo.New(db), audit, messageservice.NewMessageService(messagerepo.NewMessageRepo(db)), nil)
	h := New(svc)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	identity := func(c *gin.Context) {
		if id := c.GetHeader("X-Test-User"); id != "" {
			c.Set(authmw.ContextUserIDKey, id)
		}
		c.Next()
	}
	auth := func(c *gin.Context) {
		if c.GetString(authmw.ContextUserIDKey) == "" {
			response.Error(c, commonerrors.ErrUnauthorized)
			c.Abort()
			return
		}
		c.Next()
	}
	h.Register(router.Group("/api/meal-meetups", identity), router.Group("/api/meal-meetups", identity, auth))
	call := func(user, method, path string, body any) (int, map[string]any) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/meal-meetups"+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User", user)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var data map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &data))
		return w.Code, data
	}
	newReq := func(capacity int) domain.CreateRequest {
		return domain.CreateRequest{RequestID: uuid.NewString(), Title: "同学一起吃午饭", Description: "公共食堂见，需确认校园通行", VenueName: "二食堂", Address: "校园南门旁", StartsAt: time.Now().Add(24 * time.Hour), Timezone: "Asia/Shanghai", Budget: 30, Payment: "aa", Capacity: capacity}
	}
	create := func(capacity int) string {
		status, body := call(users[0], "POST", "", newReq(capacity))
		require.Equal(t, 200, status, body)
		return body["data"].(map[string]any)["id"].(string)
	}
	apply := func(id, user string, key string) {
		status, body := call(user, "POST", "/"+id+"/applications", domain.ApplyRequest{RequestID: key, Note: "我可以准时到"})
		require.Equal(t, 200, status, body)
	}
	respond := func(id, user, action string, revision int) int {
		status, _ := call(users[0], "POST", "/"+id+"/applications/"+user+"/respond", domain.RespondRequest{Action: action, Revision: revision})
		return status
	}

	t.Run("HTTP validation and creation idempotency", func(t *testing.T) {
		status, _ := call("", "POST", "", newReq(3))
		require.Equal(t, 401, status)
		status, _ = call(users[0], "GET", "/bad-id", nil)
		require.Equal(t, 400, status)
		req := newReq(3)
		status, body := call(users[0], "POST", "", req)
		require.Equal(t, 200, status, body)
		id := body["data"].(map[string]any)["id"]
		status, body = call(users[0], "POST", "", req)
		require.Equal(t, 200, status)
		require.Equal(t, id, body["data"].(map[string]any)["id"])
		req.Title = "改了标题"
		status, _ = call(users[0], "POST", "", req)
		require.Equal(t, 409, status)
		req = newReq(5)
		status, _ = call(users[0], "POST", "", req)
		require.Equal(t, 400, status)
		status, _ = call(users[0], "GET", "?radius_km=3", nil)
		require.Equal(t, 400, status)
	})
	t.Run("pending stays private and acceptance notifies exactly once", func(t *testing.T) {
		id := create(3)
		key := uuid.NewString()
		apply(id, users[1], key)
		apply(id, users[1], key)
		status, body := call(users[2], "GET", "/"+id, nil)
		require.Equal(t, 200, status)
		view := body["data"].(map[string]any)
		require.EqualValues(t, 1, view["member_count"])
		require.NotContains(t, view, "applications")
		require.Empty(t, view["members"])
		status, _ = call(users[1], "GET", "/"+id+"/messages", nil)
		require.Equal(t, 403, status)
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		var notices int64
		require.NoError(t, db.Model(&migrationdo.PrivateMessageDO{}).Where("extra_data ->> 'meetup_id' = ?", id).Count(&notices).Error)
		require.EqualValues(t, 2, notices)
		msg := domain.MessageRequest{RequestID: uuid.NewString(), Content: "南门见"}
		status, _ = call(users[1], "POST", "/"+id+"/messages", msg)
		require.Equal(t, 200, status)
		status, _ = call(users[1], "POST", "/"+id+"/messages", msg)
		require.Equal(t, 200, status)
		var texts int64
		require.NoError(t, db.Model(&migrationdo.MealMeetupEventDO{}).Where("meetup_id = ? AND kind = 'text'", id).Count(&texts).Error)
		require.EqualValues(t, 1, texts)
		status, _ = call(users[2], "POST", "/"+id+"/messages", domain.MessageRequest{RequestID: uuid.NewString(), Content: "越权"})
		require.Equal(t, 403, status)
	})
	t.Run("host can remove a member without exposing management revisions to visitors", func(t *testing.T) {
		id := create(2)
		apply(id, users[1], uuid.NewString())
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		status, body := call(users[0], "GET", "/"+id, nil)
		require.Equal(t, 200, status)
		members := body["data"].(map[string]any)["managed_members"].([]any)
		require.Len(t, members, 1)
		require.EqualValues(t, 1, members[0].(map[string]any)["revision"])
		status, body = call(users[2], "GET", "/"+id, nil)
		require.Equal(t, 200, status)
		require.NotContains(t, body["data"].(map[string]any), "managed_members")
		require.Equal(t, 409, respond(id, users[1], "remove", 2))
		require.Equal(t, 200, respond(id, users[1], "remove", 1))
		require.Equal(t, 200, respond(id, users[1], "remove", 1))
		status, body = call(users[1], "GET", "/"+id, nil)
		require.Equal(t, 200, status)
		view := body["data"].(map[string]any)
		require.Equal(t, "removed", view["own_status"])
		require.EqualValues(t, 1, view["member_count"])
		status, _ = call(users[1], "GET", "/"+id+"/messages", nil)
		require.Equal(t, 403, status)
		status, _ = call(users[1], "POST", "/"+id+"/applications", domain.ApplyRequest{RequestID: uuid.NewString()})
		require.Equal(t, 403, status)
	})
	t.Run("concurrent approvals cannot take the final seat twice", func(t *testing.T) {
		id := create(2)
		for _, u := range users[1:] {
			apply(id, u, uuid.NewString())
		}
		var wg sync.WaitGroup
		result := make(chan error, len(users)-1)
		for _, u := range users[1:] {
			wg.Add(1)
			go func(user string) {
				defer wg.Done()
				result <- svc.Respond(ctx, users[0], id, user, domain.RespondRequest{Action: "accept", Revision: 1})
			}(u)
		}
		wg.Wait()
		close(result)
		success := 0
		for err := range result {
			if err == nil {
				success++
			} else {
				var appErr *commonerrors.AppError
				require.ErrorAs(t, err, &appErr)
				require.Equal(t, 409, appErr.HTTPStatus)
			}
		}
		require.Equal(t, 1, success)
		view, err := svc.Detail(ctx, users[0], id)
		require.NoError(t, err)
		require.Equal(t, 2, view.MemberCount)
		require.Equal(t, "full", view.Status)
	})
	t.Run("withdraw reapply rejects stale approval and stale withdrawal", func(t *testing.T) {
		id := create(3)
		key := uuid.NewString()
		apply(id, users[1], key)
		require.NoError(t, svc.Leave(ctx, users[1], id, 1))
		require.NoError(t, svc.Leave(ctx, users[1], id, 1))
		apply(id, users[1], key)
		view, err := svc.Detail(ctx, users[1], id)
		require.NoError(t, err)
		require.Equal(t, "withdrawn", view.OwnStatus)
		apply(id, users[1], uuid.NewString())
		require.Equal(t, 409, respond(id, users[1], "accept", 1))
		require.Error(t, svc.Leave(ctx, users[1], id, 1))
		require.Equal(t, 200, respond(id, users[1], "accept", 2))
		require.NoError(t, svc.Leave(ctx, users[1], id, 2))
		_, err = svc.Messages(ctx, users[1], id)
		require.Error(t, err)
		view, err = svc.Detail(ctx, users[0], id)
		require.NoError(t, err)
		require.Equal(t, 1, view.MemberCount)
	})
	t.Run("cancel keeps accepted history but does not grant applicant room access", func(t *testing.T) {
		id := create(3)
		apply(id, users[1], uuid.NewString())
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		apply(id, users[2], uuid.NewString())
		require.NoError(t, svc.Cancel(ctx, users[0], id))
		require.NoError(t, svc.Cancel(ctx, users[0], id))
		_, err := svc.Messages(ctx, users[1], id)
		require.NoError(t, err)
		_, err = svc.Messages(ctx, users[2], id)
		require.Error(t, err)
		require.Error(t, svc.SendMessage(ctx, users[1], id, domain.MessageRequest{RequestID: uuid.NewString(), Content: "不能继续发"}))
		require.Error(t, svc.Apply(ctx, users[3], id, domain.ApplyRequest{RequestID: uuid.NewString()}))
	})
	t.Run("blocks close room and reject approvals while cleanup and reporting remain possible", func(t *testing.T) {
		id := create(4)
		apply(id, users[1], uuid.NewString())
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		apply(id, users[2], uuid.NewString())
		block := migrationdo.UserBlockDO{ID: uuid.NewString(), BlockerUserID: users[1], BlockedUserID: users[2]}
		require.NoError(t, db.Create(&block).Error)
		require.Equal(t, 403, respond(id, users[2], "accept", 1))
		block2 := migrationdo.UserBlockDO{ID: uuid.NewString(), BlockerUserID: users[1], BlockedUserID: users[0]}
		require.NoError(t, db.Create(&block2).Error)
		_, err := svc.Messages(ctx, users[1], id)
		require.Error(t, err)
		require.NoError(t, svc.Report(ctx, users[1], id, domain.ReportRequest{Reason: "harassment"}))
		require.NoError(t, svc.Leave(ctx, users[1], id, 1))
		require.NoError(t, svc.Cancel(ctx, users[0], id))
		require.NoError(t, db.Delete(&block).Error)
		require.NoError(t, db.Delete(&block2).Error)
	})
	t.Run("review unavailable or rejected writes nothing and time expiry blocks approval", func(t *testing.T) {
		id := create(3)
		audit.reject = true
		require.Error(t, svc.Apply(ctx, users[1], id, domain.ApplyRequest{RequestID: uuid.NewString(), Note: "不安全内容"}))
		audit.reject = false
		var count int64
		require.NoError(t, db.Model(&migrationdo.MealMeetupParticipantDO{}).Where("meetup_id = ?", id).Count(&count).Error)
		require.Zero(t, count)
		closed := service.New(repo.New(db), nil, nil, nil)
		_, err := closed.Create(ctx, users[0], newReq(3))
		require.Error(t, err)
		apply(id, users[1], uuid.NewString())
		require.NoError(t, db.Model(&migrationdo.MealMeetupDO{}).Where("id = ?", id).Update("starts_at", time.Now().Add(-time.Minute)).Error)
		require.Equal(t, 409, respond(id, users[1], "accept", 1))
	})
	t.Run("reports capture the correct resource and admin hiding closes discussion", func(t *testing.T) {
		id := create(3)
		apply(id, users[1], uuid.NewString())
		require.Equal(t, 200, respond(id, users[1], "accept", 1))
		require.NoError(t, svc.SendMessage(ctx, users[1], id, domain.MessageRequest{RequestID: uuid.NewString(), Content: "待举报留言"}))
		var event migrationdo.MealMeetupEventDO
		require.NoError(t, db.First(&event, "meetup_id = ? AND kind = 'text'", id).Error)
		require.NoError(t, svc.Report(ctx, users[0], id, domain.ReportRequest{EventID: event.ID, Reason: "spam"}))
		var report migrationdo.MealMeetupReportDO
		require.NoError(t, db.First(&report, "event_id = ?", event.ID).Error)
		require.Contains(t, report.Snapshot, "待举报留言")
		require.NoError(t, svc.ResolveReport(ctx, report.ID, true))
		messages, err := svc.Messages(ctx, users[0], id)
		require.NoError(t, err)
		for _, message := range messages {
			require.NotEqual(t, event.ID, message.ID)
		}
		require.NoError(t, svc.Report(ctx, users[2], id, domain.ReportRequest{Reason: "unsafe"}))
		report = migrationdo.MealMeetupReportDO{}
		require.NoError(t, db.First(&report, "target_key = ?", id).Error)
		require.NoError(t, svc.ResolveReport(ctx, report.ID, true))
		require.NoError(t, svc.ResolveReport(ctx, report.ID, true))
		var notices int64
		require.NoError(t, db.Model(&migrationdo.PrivateMessageDO{}).Where("receiver_id = ? AND extra_data ->> 'meetup_id' = ?", users[0], id).Count(&notices).Error)
		require.EqualValues(t, 2, notices) // application + moderation cancellation
		_, err = svc.List(ctx, users[2], true, domain.ListQuery{})
		require.NoError(t, err)
		_, err = svc.Detail(ctx, users[2], id)
		require.Error(t, err)
		require.Error(t, svc.SendMessage(ctx, users[1], id, domain.MessageRequest{RequestID: uuid.NewString(), Content: "不能继续发"}))
	})
}
