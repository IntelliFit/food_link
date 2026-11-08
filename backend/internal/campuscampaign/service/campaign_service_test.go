package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscampaign/domain"
	"food_link/backend/internal/campuscampaign/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/migration/do"
	researchdomain "food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type grantCall struct {
	userID, key, plan string
	days              int
}

type fakeGranter struct{ calls []grantCall }

func (f *fakeGranter) GrantCampusCampaignMembership(_ context.Context, userID, key, plan string, days int, _ map[string]any) error {
	f.calls = append(f.calls, grantCall{userID, key, plan, days})
	return nil
}

type fixture struct {
	db       *gorm.DB
	svc      *CampaignService
	granter  *fakeGranter
	schoolID string
	otherID  string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	db := testdb.New(t)
	models := append(do.CampusCampaignModels(), do.ResearchWeightModels()...)
	models = append(models, &do.UserDO{}, &do.SchoolDO{}, &do.CampusFoodCatalogItemDO{}, &do.FoodRecordDO{}, &do.AnalysisTaskDO{})
	require.NoError(t, db.AutoMigrate(models...))
	f := &fixture{db: db, granter: &fakeGranter{}, schoolID: uuid.NewString(), otherID: uuid.NewString()}
	require.NoError(t, db.Create(&do.SchoolDO{ID: f.schoolID, Name: "清华大学", Status: "active"}).Error)
	require.NoError(t, db.Create(&do.SchoolDO{ID: f.otherID, Name: "北京大学", Status: "active"}).Error)
	f.svc = NewCampaignService(repo.NewCampaignRepo(db), f.granter)
	return f
}

func (f *fixture) user(t *testing.T, nickname string) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, f.db.Create(&do.UserDO{ID: id, OpenID: "o-" + id, Nickname: &nickname}).Error)
	return id
}

func (f *fixture) dish(t *testing.T, schoolID, name string) string {
	t.Helper()
	id, canteen := uuid.NewString(), uuid.NewString()
	require.NoError(t, f.db.Create(&do.CampusFoodCatalogItemDO{
		ID: id, BatchID: uuid.NewString(), Name: &name, SchoolID: &schoolID, CanteenID: &canteen,
		OrganizationName: "饮食中心", CanteenName: "桃李园", Status: "published",
	}).Error)
	return id
}

// activeCampaign creates a club and an active campaign with a leader.
func (f *fixture) activeCampaign(t *testing.T, schoolID string, cap int, leaderID string) *domain.CampaignView {
	t.Helper()
	ctx := context.Background()
	org, err := f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: schoolID, Name: "健身协会-" + uuid.NewString()[:6]})
	require.NoError(t, err)
	now := time.Now()
	view, err := f.svc.CreateCampaign(ctx, "admin", CampaignInput{
		OrgID: org.ID, Title: "秋季称重月", StartsAt: now.Add(-time.Hour), EndsAt: now.Add(20*24*time.Hour - time.Minute),
		Status: domain.CampaignActive, CoreMemberCap: &cap, LeaderUserIDs: []string{leaderID},
	})
	require.NoError(t, err)
	require.Len(t, view.JoinCode, 6)
	return view
}

func joinInput(hasScale bool) JoinInput {
	precision := 1.0
	return JoinInput{HasScale: hasScale, ScalePrecisionGrams: &precision, Source: "qr", ConsentVersion: researchdomain.ConsentVersion}
}

func requireStatus(t *testing.T, err error, status int) {
	t.Helper()
	appErr, ok := err.(*commonerrors.AppError)
	require.True(t, ok, "want an AppError, got %v", err)
	require.Equal(t, status, appErr.HTTPStatus, appErr.Message)
}

func TestJoinAttributesSamplesToTheActiveCampaign(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	leader, member := f.user(t, "社长"), f.user(t, "小王")
	campaign := f.activeCampaign(t, f.schoolID, 15, leader)
	require.Len(t, f.granter.calls, 1, "the leader gets the core membership")
	require.Equal(t, 20, f.granter.calls[0].days)
	require.Equal(t, domain.DefaultMembershipPlan, f.granter.calls[0].plan)

	landing, err := f.svc.Landing(ctx, campaign.JoinCode)
	require.NoError(t, err)
	require.True(t, landing.Open)
	require.Equal(t, "清华大学", landing.SchoolName)

	_, err = f.svc.Join(ctx, member, campaign.JoinCode, JoinInput{ConsentVersion: "old"})
	require.ErrorContains(t, err, "授权")
	mine, err := f.svc.Join(ctx, member, campaign.JoinCode, joinInput(true))
	require.NoError(t, err)
	require.Equal(t, campaign.ID, mine.Campaign.ID)
	require.Equal(t, domain.RoleMember, mine.Role)
	require.True(t, mine.HasScale)
	require.EqualValues(t, 2, mine.Campaign.MemberCount)

	other := f.activeCampaign(t, f.otherID, 15, f.user(t, "北大社长"))
	_, err = f.svc.Join(ctx, member, other.JoinCode, joinInput(false))
	require.ErrorContains(t, err, "同一时间只能参加一个活动")

	attribution, err := f.svc.AttributeSample(ctx, member, SampleAttributionInput{})
	require.NoError(t, err)
	require.Equal(t, campaign.ID, attribution.CampaignID)
	require.Equal(t, domain.ChannelSelfScale, attribution.Channel)

	none, err := f.svc.AttributeSample(ctx, f.user(t, "路人"), SampleAttributionInput{})
	require.NoError(t, err)
	require.Nil(t, none, "people outside a campaign stay personal")

	today := time.Now().In(chinaTime).Format(time.DateOnly)
	station, err := f.svc.CreateStation(ctx, leader, campaign.ID, StationInput{SessionDate: today, MealPeriod: "lunch", LocationText: "紫荆操场", ScalePrecisionGrams: 1})
	require.NoError(t, err)
	attribution, err = f.svc.AttributeSample(ctx, member, SampleAttributionInput{StationSessionID: station.ID})
	require.NoError(t, err)
	require.Equal(t, domain.ChannelStation, attribution.Channel)
	require.Equal(t, station.ID, *attribution.StationSessionID)

	_, err = f.svc.CreateStation(ctx, leader, campaign.ID, StationInput{SessionDate: today, MealPeriod: "lunch", Kind: domain.StationSameDish, LocationText: "桃李园", ScalePrecisionGrams: 1})
	require.ErrorContains(t, err, "哪道菜")
	dish := f.dish(t, f.schoolID, "宫保鸡丁")
	sameDish, err := f.svc.CreateStation(ctx, leader, campaign.ID, StationInput{SessionDate: today, MealPeriod: "lunch", Kind: domain.StationSameDish, CatalogItemID: dish, LocationText: "桃李园", ScalePrecisionGrams: 1})
	require.NoError(t, err)
	attribution, err = f.svc.AttributeSample(ctx, member, SampleAttributionInput{StationSessionID: sameDish.ID})
	require.NoError(t, err)
	require.Equal(t, domain.ChannelSameDish, attribution.Channel)
	require.Equal(t, dish, *attribution.CatalogItemID)

	_, err = f.svc.CreateStation(ctx, member, campaign.ID, StationInput{SessionDate: today, MealPeriod: "lunch", LocationText: "x", ScalePrecisionGrams: 1})
	requireStatus(t, err, 400)
	_, err = f.svc.AttributeSample(ctx, member, SampleAttributionInput{CatalogItemID: f.dish(t, f.otherID, "北大的菜")})
	require.ErrorContains(t, err, "本校")

	mine, err = f.svc.Mine(ctx, member)
	require.NoError(t, err)
	require.Len(t, mine.Stations, 2)
	require.Equal(t, today, mine.Stations[0].SessionDate, "dates come back as YYYY-MM-DD")

	// A weighing day from last week no longer takes samples.
	require.NoError(t, f.db.Exec(`UPDATE campus_station_sessions SET session_date = current_date - 7 WHERE id = ?`, station.ID).Error)
	_, err = f.svc.AttributeSample(ctx, member, SampleAttributionInput{StationSessionID: station.ID})
	require.ErrorContains(t, err, "已经过了")
	_, err = f.svc.AttributeSample(ctx, member, SampleAttributionInput{StationSessionID: "not-a-uuid"})
	requireStatus(t, err, 400)

	// Once the campaign ends, new samples stay personal, tagging says why it
	// did not count, and nobody else can join.
	require.NoError(t, f.db.Exec(`UPDATE campus_campaigns SET ends_at = now() - interval '1 minute' WHERE id = ?`, campaign.ID).Error)
	ended, err := f.svc.AttributeSample(ctx, member, SampleAttributionInput{})
	require.NoError(t, err)
	require.Nil(t, ended, "samples after the end stay personal")
	_, err = f.svc.LinkRecord(ctx, member, RecordLinkInput{FoodRecordID: uuid.NewString()})
	require.ErrorContains(t, err, "结束")
	_, err = f.svc.Join(ctx, f.user(t, "迟到"), campaign.JoinCode, joinInput(false))
	require.ErrorContains(t, err, "不在进行中")
}

func TestSetCoreRespectsTheCapAndGrantsMembershipOnce(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	leader, a, b := f.user(t, "社长"), f.user(t, "甲"), f.user(t, "乙")
	campaign := f.activeCampaign(t, f.schoolID, 1, leader)
	for _, id := range []string{a, b} {
		_, err := f.svc.Join(ctx, id, campaign.JoinCode, joinInput(false))
		require.NoError(t, err)
	}
	view, err := f.svc.SetCore(ctx, leader, campaign.ID, a, true)
	require.NoError(t, err)
	require.Equal(t, 1, view.CoreCount)
	_, err = f.svc.SetCore(ctx, leader, campaign.ID, a, true)
	require.NoError(t, err)
	require.Len(t, f.granter.calls, 2, "leader + 甲, and 甲 only once")
	require.Equal(t, a, f.granter.calls[1].userID)

	_, err = f.svc.SetCore(ctx, leader, campaign.ID, b, true)
	require.ErrorContains(t, err, "最多1人")
	_, err = f.svc.SetCore(ctx, a, campaign.ID, b, true)
	requireStatus(t, err, 400)

	view, err = f.svc.SetCore(ctx, leader, campaign.ID, a, false)
	require.NoError(t, err)
	require.Zero(t, view.CoreCount)
	// 甲 already received the membership, so unmarking does not free the slot.
	_, err = f.svc.SetCore(ctx, leader, campaign.ID, b, true)
	require.ErrorContains(t, err, "最多1人")
	_, err = f.svc.SetCore(ctx, leader, campaign.ID, a, true)
	require.NoError(t, err, "re-marking someone already granted needs no new slot")
	require.Len(t, f.granter.calls, 2, "and grants nothing again")
	_, err = f.svc.SetCore(ctx, leader, campaign.ID, leader, false)
	require.ErrorContains(t, err, "负责人")
}

func TestLinkRecordAndBoardsCountOnlyTheirOwnData(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	leader, member := f.user(t, "社长"), f.user(t, "小王")
	campaign := f.activeCampaign(t, f.schoolID, 15, leader)
	_, err := f.svc.Join(ctx, member, campaign.JoinCode, joinInput(false))
	require.NoError(t, err)

	taskID, recordID, grams := uuid.NewString(), uuid.NewString(), 420
	require.NoError(t, f.db.Create(&do.AnalysisTaskDO{ID: taskID, UserID: member, TaskType: "food", Status: "done", Payload: map[string]any{"execution_mode": "strict"}}).Error)
	require.NoError(t, f.db.Create(&do.FoodRecordDO{ID: recordID, UserID: member, MealType: "lunch", TotalWeightGrams: &grams, SourceTaskID: &taskID}).Error)
	dish := f.dish(t, f.schoolID, "番茄炒蛋")

	linked, err := f.svc.LinkRecord(ctx, member, RecordLinkInput{FoodRecordID: recordID, CatalogItemID: dish})
	require.NoError(t, err)
	require.True(t, linked)
	linked, err = f.svc.LinkRecord(ctx, member, RecordLinkInput{FoodRecordID: recordID, CatalogItemID: dish})
	require.NoError(t, err)
	require.False(t, linked, "a record is linked once")
	var saved domain.Record
	require.NoError(t, f.db.Where("food_record_id = ?", recordID).First(&saved).Error)
	require.Equal(t, "strict", saved.ExecutionMode)
	require.Equal(t, domain.LabelModelEstimate, saved.LabelSource)
	require.InDelta(t, 420, *saved.EstimatedTotalGrams, 0.01)
	require.Equal(t, "番茄炒蛋", saved.DishName)
	mine, err := f.svc.Mine(ctx, member)
	require.NoError(t, err)
	require.Equal(t, []domain.LinkedRecord{{FoodRecordID: recordID, DishName: "番茄炒蛋"}}, mine.Linked, "the page marks counted meals after a reload")

	_, err = f.svc.LinkRecord(ctx, leader, RecordLinkInput{FoodRecordID: recordID})
	requireStatus(t, err, 404)

	// Two approved weighed samples for the member, one for the leader, and a
	// C-grade sample that is kept but never ranked.
	tierB, tierC := "B", "C"
	campaignC := campaign.ID
	require.NoError(t, f.db.Create(&researchdomain.Sample{
		UserID: leader, ClientKey: uuid.NewString(), Scene: "canteen", WeighingMode: "whole", ContainerType: "bowl", TareMode: "measured",
		TotalNetGrams: 280, ConsentVersion: researchdomain.ConsentVersion, ConsentedAt: time.Now(), Status: researchdomain.StatusApproved,
		QualityTier: &tierC, CampaignID: &campaignC, CollectionChannel: domain.ChannelSelfScale,
		Items: []researchdomain.Item{}, Photos: []researchdomain.Photo{}, Device: map[string]any{},
	}).Error)
	for index, owner := range []string{member, member, leader} {
		campaignID := campaign.ID
		require.NoError(t, f.db.Create(&researchdomain.Sample{
			UserID: owner, ClientKey: uuid.NewString(), Scene: "canteen", WeighingMode: "whole", ContainerType: "bowl", TareMode: "measured",
			TotalNetGrams: float64(300 + index), ConsentVersion: researchdomain.ConsentVersion, ConsentedAt: time.Now(),
			Status: researchdomain.StatusApproved, QualityTier: &tierB, CampaignID: &campaignID, CollectionChannel: domain.ChannelSelfScale, CatalogItemID: &dish,
			Items: []researchdomain.Item{}, Photos: []researchdomain.Photo{}, Device: map[string]any{},
		}).Error)
	}
	board, err := f.svc.MembersBoard(ctx, campaign.JoinCode, member)
	require.NoError(t, err)
	require.Len(t, board, 2)
	require.Equal(t, "小王", board[0].Name)
	require.EqualValues(t, 2, board[0].Approved)
	guestBoard, err := f.svc.MembersBoard(ctx, campaign.JoinCode, "")
	require.NoError(t, err)
	require.Equal(t, "小同学", guestBoard[0].Name, "guests see masked names")

	schools, err := f.svc.CampaignsBoard(ctx)
	require.NoError(t, err)
	require.Len(t, schools, 1)
	require.EqualValues(t, 3, schools[0].Approved)
	require.EqualValues(t, 1, schools[0].Dishes)
	require.InDelta(t, 1.5, schools[0].PerMember, 0.01)

	leaderView, err := f.svc.Leader(ctx, leader, campaign.ID)
	require.NoError(t, err)
	require.Len(t, leaderView.Members, 2)
	require.EqualValues(t, 1, leaderView.Members[0].PhotoRecords)
}

func TestDishSearchFallsBackToCloseNamesForMembersOnly(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	leader, member, outsider := f.user(t, "社长"), f.user(t, "小王"), f.user(t, "路人")
	campaign := f.activeCampaign(t, f.schoolID, 15, leader)
	_, err := f.svc.Join(ctx, member, campaign.JoinCode, joinInput(false))
	require.NoError(t, err)
	tomato := f.dish(t, f.schoolID, "番茄炒蛋")
	f.dish(t, f.schoolID, "红烧肉")

	found, err := f.svc.SearchDishes(ctx, member, campaign.ID, "炒蛋")
	require.NoError(t, err)
	require.Len(t, found, 1)
	require.Equal(t, tomato, found[0].ID)
	require.False(t, found[0].Close)

	found, err = f.svc.SearchDishes(ctx, member, campaign.ID, "西红柿炒蛋")
	require.NoError(t, err)
	require.Len(t, found, 1, "no name contains the query, so dishes sharing 炒蛋 come back")
	require.Equal(t, tomato, found[0].ID)
	require.True(t, found[0].Close)

	_, err = f.svc.SearchDishes(ctx, outsider, campaign.ID, "炒蛋")
	requireStatus(t, err, 400)
}

func TestDraftCampaignsAreNotPublic(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	org, err := f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: "健身协会"})
	require.NoError(t, err)
	_, err = f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: "健身协会"})
	require.ErrorContains(t, err, "已经有社团")
	now := time.Now()
	draft, err := f.svc.CreateCampaign(ctx, "admin", CampaignInput{OrgID: org.ID, Title: "草稿", StartsAt: now, EndsAt: now.Add(time.Hour)})
	require.NoError(t, err)
	_, err = f.svc.Landing(ctx, draft.JoinCode)
	requireStatus(t, err, 404)
	_, err = f.svc.Join(ctx, f.user(t, "x"), draft.JoinCode, joinInput(false))
	requireStatus(t, err, 404)

	_, err = f.svc.CreateCampaign(ctx, "admin", CampaignInput{OrgID: org.ID, Title: "倒着的时间", StartsAt: now, EndsAt: now.Add(-time.Hour)})
	require.ErrorContains(t, err, "起止时间")
}

func TestGrantDaysCoverTheRestOfTheCampaign(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	require.Equal(t, 1, grantDays(now, now.Add(time.Hour)))
	require.Equal(t, 28, grantDays(now, now.Add(27*24*time.Hour+time.Minute)))
	require.Equal(t, domain.MaxGrantDays, grantDays(now, now.Add(400*24*time.Hour)))
	require.Equal(t, 1, grantDays(now, now.Add(-time.Hour)))
}

func TestActivatingACampaignGrantsWaitingLeadersAndKeepsScaleSettings(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	leader := f.user(t, "社长")
	org, err := f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: "健身协会"})
	require.NoError(t, err)
	now := time.Now()
	input := CampaignInput{OrgID: org.ID, Title: "草稿期", StartsAt: now.Add(-time.Hour), EndsAt: now.Add(10 * 24 * time.Hour), LeaderUserIDs: []string{leader}}
	draft, err := f.svc.CreateCampaign(ctx, "admin", input)
	require.NoError(t, err)
	require.Empty(t, f.granter.calls, "a draft grants nothing")

	// The leader had joined as an ordinary member with a scale before.
	require.NoError(t, f.db.Exec(`UPDATE campus_campaign_members SET has_scale = true, scale_precision_grams = 0.1 WHERE user_id = ?`, leader).Error)
	require.NoError(t, f.svc.AddLeader(ctx, draft.ID, leader))
	var member domain.Member
	require.NoError(t, f.db.Where("campaign_id = ? AND user_id = ?", draft.ID, leader).First(&member).Error)
	require.True(t, member.HasScale, "making someone leader keeps their scale settings")

	input.Status = domain.CampaignActive
	input.LeaderUserIDs = nil
	_, err = f.svc.UpdateCampaign(ctx, draft.ID, input)
	require.NoError(t, err)
	require.Len(t, f.granter.calls, 1, "activation grants the waiting leader")
	require.Equal(t, leader, f.granter.calls[0].userID)
	_, err = f.svc.UpdateCampaign(ctx, draft.ID, input)
	require.NoError(t, err)
	require.Len(t, f.granter.calls, 1, "and only once")
}

func TestClubsAreNotCreatedTwiceUnderSlightlyDifferentNames(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	first, err := f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: " 清华大学健身协会 "})
	require.NoError(t, err)
	require.Equal(t, "清华大学健身协会", first.Name)
	for _, again := range []string{"健身协会", "健身 协会", "清华大学 健身协会"} {
		_, err = f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: again})
		require.ErrorContains(t, err, "已经有社团「清华大学健身协会」", again)
	}
	_, err = f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: "健美协会"})
	require.NoError(t, err, "a different club at the same school is fine")
	_, err = f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.otherID, Name: "健身协会"})
	require.NoError(t, err, "the same name at another school is fine")

	orgs, err := f.svc.ListOrgs(ctx)
	require.NoError(t, err)
	require.Len(t, orgs, 3)
	byName := map[string]domain.OrgView{}
	for _, org := range orgs {
		byName[org.SchoolName+"/"+org.Name] = org
	}
	require.Contains(t, byName, "清华大学/清华大学健身协会")
	require.Contains(t, byName, "北京大学/健身协会")
}

func TestOnlyClubsWithoutCampaignsCanBeDeleted(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	mistake, err := f.svc.CreateOrg(ctx, "admin", OrgInput{SchoolID: f.schoolID, Name: "建错的社团"})
	require.NoError(t, err)
	require.NoError(t, f.svc.DeleteOrg(ctx, mistake.ID))
	require.ErrorContains(t, f.svc.DeleteOrg(ctx, mistake.ID), "不存在")

	f.activeCampaign(t, f.schoolID, 15, f.user(t, "社长"))
	orgs, err := f.svc.ListOrgs(ctx)
	require.NoError(t, err)
	require.Len(t, orgs, 1)
	require.EqualValues(t, 1, orgs[0].CampaignCount)
	require.ErrorContains(t, f.svc.DeleteOrg(ctx, orgs[0].ID), "已经建过活动")
	require.ErrorContains(t, f.svc.DeleteOrg(ctx, "not-a-uuid"), "不存在")
}

func TestClubKeyIgnoresSpacesCaseAndTheSchoolPrefix(t *testing.T) {
	require.Equal(t, clubKey("清华大学健身协会", "清华大学"), clubKey("健身协会", "清华大学"))
	require.Equal(t, clubKey("Fitness Club", "清华大学"), clubKey("fitnessclub", "清华大学"))
	require.NotEqual(t, clubKey("健美协会", "清华大学"), clubKey("健身协会", "清华大学"))
	require.Equal(t, "清华大学", clubKey("清华大学", "清华大学"), "a club named only after the school keeps its name")
}
