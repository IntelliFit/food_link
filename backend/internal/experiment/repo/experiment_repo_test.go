package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/experiment/domain"
	"food_link/backend/internal/experiment/service"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, migration.MigrateExperimentTables(ctx, db))
	require.NoError(t, db.Exec(`
CREATE TABLE weapp_user (id uuid PRIMARY KEY, create_time timestamptz);
CREATE TABLE analysis_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, task_type text NOT NULL DEFAULT 'food', payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL);
CREATE TABLE user_food_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz NOT NULL);`).Error)
	return db
}

func TestTouchVisitorKeepsFirstSeenAndFirstBinding(t *testing.T) {
	db := setupDB(t)
	repo := NewExperimentRepo(db)
	ctx := context.Background()
	t1 := time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC)
	userA, userB := uuid.NewString(), uuid.NewString()

	v, err := repo.TouchVisitor(ctx, domain.Visitor{AnonID: "anon_touch_1", Platform: "ios", FirstSeenAt: t1, LastSeenAt: t1})
	require.NoError(t, err)
	require.Nil(t, v.UserID)

	t2 := t1.Add(time.Hour)
	v, err = repo.TouchVisitor(ctx, domain.Visitor{AnonID: "anon_touch_1", UserID: &userA, Platform: "android", FirstSeenAt: t2, LastSeenAt: t2})
	require.NoError(t, err)
	require.True(t, v.FirstSeenAt.Equal(t1), "首次出现时间不能被覆盖")
	require.Equal(t, userA, *v.UserID)
	require.True(t, v.BoundAt.Equal(t2))
	require.Equal(t, "android", v.Platform)

	t3 := t2.Add(time.Hour)
	v, err = repo.TouchVisitor(ctx, domain.Visitor{AnonID: "anon_touch_1", UserID: &userB, FirstSeenAt: t3, LastSeenAt: t3})
	require.NoError(t, err)
	require.Equal(t, userA, *v.UserID, "已绑定的账号不能被另一个账号覆盖")
	require.True(t, v.BoundAt.Equal(t2))
	require.True(t, v.LastSeenAt.Equal(t3))
}

func TestCreateAssignmentKeepsFirstRow(t *testing.T) {
	db := setupDB(t)
	repo := NewExperimentRepo(db)
	ctx := context.Background()
	now := time.Now().UTC()

	first, err := repo.CreateAssignment(ctx, domain.Assignment{ID: uuid.NewString(), ExperimentKey: "exp_race", AnonID: "anon_race_1", Variant: "control", AssignedAt: now})
	require.NoError(t, err)
	second, err := repo.CreateAssignment(ctx, domain.Assignment{ID: uuid.NewString(), ExperimentKey: "exp_race", AnonID: "anon_race_1", Variant: "new", AssignedAt: now})
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, "control", second.Variant, "并发重复写入应保留第一条分组")

	// The same account racing in from a second phone keeps one row too.
	user := uuid.NewString()
	phoneA, err := repo.CreateAssignment(ctx, domain.Assignment{ID: uuid.NewString(), ExperimentKey: "exp_race", AnonID: "anon_phone_a", UserID: &user, Variant: "new", AssignedAt: now})
	require.NoError(t, err)
	phoneB, err := repo.CreateAssignment(ctx, domain.Assignment{ID: uuid.NewString(), ExperimentKey: "exp_race", AnonID: "anon_phone_b", UserID: &user, Variant: "control", AssignedAt: now})
	require.NoError(t, err)
	require.Equal(t, phoneA.ID, phoneB.ID, "同一账号在两台手机同时首次分组应只保留一条")
	require.Equal(t, "new", phoneB.Variant)

	// Binding a pre-login row to an account that already owns one is refused.
	unbound, err := repo.CreateAssignment(ctx, domain.Assignment{ID: uuid.NewString(), ExperimentKey: "exp_race", AnonID: "anon_phone_c", Variant: "control", AssignedAt: now})
	require.NoError(t, err)
	bound, err := repo.BindAssignment(ctx, unbound.ID, "exp_race", user, nil)
	require.NoError(t, err)
	require.False(t, bound)
	other := uuid.NewString()
	bound, err = repo.BindAssignment(ctx, unbound.ID, "exp_race", other, nil)
	require.NoError(t, err)
	require.True(t, bound)
	bound, err = repo.BindAssignment(ctx, unbound.ID, "exp_race", uuid.NewString(), nil)
	require.NoError(t, err)
	require.False(t, bound, "已绑定的分组不能再被别的账号绑定")
}

// The end-to-end path through the real repository: enrol before login, bind
// at login, expose, and read the outcome counts from business tables.
func TestServiceFlowAndSummary(t *testing.T) {
	db := setupDB(t)
	repo := NewExperimentRepo(db)
	svc := service.NewService(repo)
	ctx := context.Background()

	saved, err := svc.Save(ctx, "onboarding_v2", service.SaveInput{
		Status:   domain.StatusRunning,
		Audience: domain.AudienceNewUsers,
		Variants: []domain.Variant{{Key: "control", Weight: 50}, {Key: "pet_flow", Weight: 50}},
	})
	require.NoError(t, err)
	require.NotNil(t, saved.StartedAt)

	newUser, oldUser := uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO weapp_user (id, create_time) VALUES (?, now() + interval '1 second'), (?, now() - interval '30 days')", newUser, oldUser).Error)

	served, err := svc.Assignments(ctx, service.AssignInput{AnonID: "anon_flow_new"})
	require.NoError(t, err)
	first := served["onboarding_v2"]
	require.True(t, first.Tracked)

	served, err = svc.Assignments(ctx, service.AssignInput{AnonID: "anon_flow_new", UserID: newUser})
	require.NoError(t, err)
	require.Equal(t, first, served["onboarding_v2"], "新账号登录后应沿用登录前的分组")

	_, err = svc.Assignments(ctx, service.AssignInput{AnonID: "anon_flow_old"})
	require.NoError(t, err)
	served, err = svc.Assignments(ctx, service.AssignInput{AnonID: "anon_flow_old", UserID: oldUser})
	require.NoError(t, err)
	require.False(t, served["onboarding_v2"].Tracked, "老账号登录后应被排除")

	n, err := svc.Expose(ctx, "anon_flow_new", newUser, []string{"onboarding_v2"})
	require.NoError(t, err)
	require.Equal(t, int64(1), n)
	n, err = svc.Expose(ctx, "anon_flow_new", newUser, []string{"onboarding_v2"})
	require.NoError(t, err)
	require.Equal(t, int64(0), n, "曝光时间只记第一次")
	n, err = svc.Expose(ctx, "anon_flow_old", oldUser, []string{"onboarding_v2"})
	require.NoError(t, err)
	require.Equal(t, int64(0), n, "被排除的分组不记曝光")

	// Move the exposure back so both outcome windows have elapsed.
	require.NoError(t, db.Exec(`UPDATE experiment_assignments SET first_exposed_at = now() - interval '50 hours' WHERE anon_id = 'anon_flow_new'`).Error)
	require.NoError(t, db.Exec(`INSERT INTO analysis_tasks (user_id, task_type, payload, created_at) VALUES
		(?, 'health_report', '{}', now() - interval '49 hours'),
		(?, 'food', '{"exercise": true}', now() - interval '49 hours'),
		(?, 'food', '{}', now() - interval '49 hours')`, newUser, newUser, oldUser).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_food_records (user_id, created_at) VALUES (?, now() - interval '48 hours'), (?, now() - interval '20 hours')`, newUser, newUser).Error)
	require.NoError(t, db.Exec(`INSERT INTO app_events (id, anon_id, name, props, created_at) VALUES (gen_random_uuid(), 'anon_flow_new', 'srv.onboarding_try', '{}', now() - interval '49 hours')`).Error)

	_, err = svc.Track(ctx, "anon_flow_new", newUser, []service.EventInput{{Name: "welcome_view"}, {Name: "persona_pick", Props: map[string]any{"persona": "gym"}}})
	require.NoError(t, err)
	var events int64
	require.NoError(t, db.Raw("SELECT count(*) FROM app_events WHERE anon_id = 'anon_flow_new' AND user_id = ?", newUser).Scan(&events).Error)
	require.Equal(t, int64(2), events)

	summary, err := svc.Summary(ctx, "onboarding_v2")
	require.NoError(t, err)
	totals := domain.VariantSummary{}
	for _, row := range summary {
		totals.Assigned += row.Assigned
		totals.Excluded += row.Excluded
		totals.Exposed += row.Exposed
		totals.ExposedLoggedIn += row.ExposedLoggedIn
		totals.Matured24h += row.Matured24h
		totals.Matured48h += row.Matured48h
		totals.AIWithin24h += row.AIWithin24h
		totals.RecordWithin24h += row.RecordWithin24h
		totals.RecordOnSecondDay += row.RecordOnSecondDay
	}
	require.Equal(t, domain.VariantSummary{Assigned: 2, Excluded: 1, Exposed: 1, ExposedLoggedIn: 1, Matured24h: 1, Matured48h: 1, AIWithin24h: 1, RecordWithin24h: 1, RecordOnSecondDay: 1}, totals,
		"体检报告和运动识别不算，引导页的游客体验算饮食 AI 使用")

	require.NoError(t, db.Exec(`INSERT INTO analysis_tasks (user_id, task_type, payload, created_at) VALUES (?, 'food_text', '{}', now() - interval '45 hours')`, newUser).Error)
	require.NoError(t, db.Exec(`UPDATE experiment_assignments SET first_exposed_at = now() - interval '30 hours' WHERE anon_id = 'anon_flow_new'`).Error)
	summary, err = svc.Summary(ctx, "onboarding_v2")
	require.NoError(t, err)
	var matured48 int64
	for _, row := range summary {
		matured48 += row.Matured48h + row.RecordOnSecondDay
	}
	require.Zero(t, matured48, "第二天窗口未结束时不计入分母和结果")

	_, err = svc.Summary(ctx, "missing_exp")
	require.Error(t, err)
}
