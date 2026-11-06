package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestMigrateCampusCampaignIsIdempotentAndConstrainsRows(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, MigrateCampusCampaign(ctx, db, "public"))
	require.NoError(t, MigrateCampusCampaign(ctx, db, "public"))

	school, org := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	require.NoError(t, db.Exec(`INSERT INTO campus_orgs (id, school_id, name) VALUES (?, ?, '健身协会')`, org, school).Error)
	require.Error(t, db.Exec(`INSERT INTO campus_orgs (school_id, name) VALUES (?, '健身协会')`, school).Error, "one name per school")

	campaign := `INSERT INTO campus_campaigns (org_id, school_id, title, join_code, starts_at, ends_at, core_member_cap) VALUES (?, ?, 't', ?, now(), now() + ?::interval, ?)`
	require.NoError(t, db.Exec(campaign, org, school, "ABC234", "20 days", 15).Error)
	require.Error(t, db.Exec(campaign, org, school, "ABC234", "20 days", 15).Error, "join codes are unique")
	require.Error(t, db.Exec(campaign, org, school, "ZZZ234", "-1 day", 15).Error, "the window must end after it starts")
	require.Error(t, db.Exec(campaign, org, school, "YYY234", "1 day", 500).Error, "the core cap is bounded")

	var campaignID string
	require.NoError(t, db.Raw(`SELECT id FROM campus_campaigns WHERE join_code = 'ABC234'`).Scan(&campaignID).Error)
	member := `INSERT INTO campus_campaign_members (campaign_id, user_id, role) VALUES (?, '33333333-3333-3333-3333-333333333333', ?)`
	require.NoError(t, db.Exec(member, campaignID, "core").Error)
	require.Error(t, db.Exec(member, campaignID, "member").Error, "one membership per campaign and user")
	require.Error(t, db.Exec(`INSERT INTO campus_campaign_members (campaign_id, user_id, role) VALUES (?, gen_random_uuid(), 'boss')`, campaignID).Error)

	record := `INSERT INTO campus_campaign_records (campaign_id, user_id, food_record_id, label_source) VALUES (?, gen_random_uuid(), ?, ?)`
	require.NoError(t, db.Exec(record, campaignID, "44444444-4444-4444-4444-444444444444", "model_estimate").Error)
	require.Error(t, db.Exec(record, campaignID, "55555555-5555-5555-5555-555555555555", "scale_measured").Error,
		"photo estimates can never be stored as measured")
	require.Error(t, db.Exec(`INSERT INTO campus_station_sessions (campaign_id, created_by_user_id, session_date, meal_period) VALUES (?, gen_random_uuid(), current_date, 'midnight')`, campaignID).Error)
}
