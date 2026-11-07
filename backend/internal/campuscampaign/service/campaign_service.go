package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"slices"
	"strings"
	"time"

	"food_link/backend/internal/campuscampaign/domain"
	"food_link/backend/internal/campuscampaign/repo"
	commonerrors "food_link/backend/internal/common/errors"
	researchdomain "food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	CreateOrg(ctx context.Context, org *domain.Org) error
	GetOrg(ctx context.Context, id string) (*domain.Org, error)
	ListOrgs(ctx context.Context) ([]domain.Org, error)
	CreateCampaign(ctx context.Context, campaign *domain.Campaign) error
	UpdateCampaign(ctx context.Context, id string, updates map[string]any) error
	GetCampaign(ctx context.Context, id string) (*domain.Campaign, error)
	GetCampaignByCode(ctx context.Context, code string) (*domain.Campaign, error)
	ListCampaigns(ctx context.Context, status string) ([]domain.Campaign, error)
	SchoolName(ctx context.Context, schoolID string) (string, error)
	ActiveMembership(ctx context.Context, userID string, now time.Time) (*domain.Member, *domain.Campaign, error)
	GetMember(ctx context.Context, campaignID, userID string) (*domain.Member, error)
	UpsertMember(ctx context.Context, member *domain.Member) (*domain.Member, error)
	SetRole(ctx context.Context, campaignID, userID, role string, markedBy *string, at *time.Time) error
	MarkMembershipGranted(ctx context.Context, campaignID, userID string, days int, at time.Time) error
	MarkCore(ctx context.Context, campaignID, userID, markedBy string, quota int, at time.Time) (bool, error)
	UngrantedPrivileged(ctx context.Context, campaignID string) ([]domain.Member, error)
	CountRole(ctx context.Context, campaignID, role string) (int64, error)
	MemberCounts(ctx context.Context, campaignIDs []string) (map[string][2]int64, error)
	MemberStats(ctx context.Context, campaignID string) ([]domain.MemberStats, error)
	CampaignsBoard(ctx context.Context, now time.Time) ([]domain.BoardEntry, error)
	CreateStation(ctx context.Context, station *domain.Station) error
	GetStation(ctx context.Context, id string) (*domain.Station, error)
	ListStations(ctx context.Context, campaignID, fromDate string) ([]domain.Station, error)
	CreateRecord(ctx context.Context, record *domain.Record) (bool, error)
	FoodRecordForUser(ctx context.Context, recordID, userID string) (*repo.FoodRecordRef, error)
	CatalogItem(ctx context.Context, id string) (*repo.CatalogItemRef, error)
}

// MembershipGranter gives core members membership for the campaign.
type MembershipGranter interface {
	GrantCampusCampaignMembership(ctx context.Context, userID, sourceKey, planCode string, days int, meta map[string]any) error
}

type CampaignService struct {
	repo       Repository
	membership MembershipGranter
	now        func() time.Time
}

func NewCampaignService(repo Repository, membership MembershipGranter) *CampaignService {
	return &CampaignService{repo: repo, membership: membership, now: time.Now}
}

// --- members -------------------------------------------------------------------

type JoinInput struct {
	HasScale            bool     `json:"has_scale"`
	ScalePrecisionGrams *float64 `json:"scale_precision_grams"`
	Source              string   `json:"join_source"`
	ConsentVersion      string   `json:"consent_version"`
}

// Landing returns a campaign as guests see it; drafts are not public.
func (s *CampaignService) Landing(ctx context.Context, code string) (*domain.CampaignView, error) {
	campaign, err := s.campaignByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	return s.view(ctx, campaign)
}

func (s *CampaignService) Join(ctx context.Context, userID, code string, input JoinInput) (*domain.MineView, error) {
	campaign, err := s.campaignByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if !s.open(campaign) {
		return nil, badRequest("活动不在进行中，暂时不能加入")
	}
	if strings.TrimSpace(input.ConsentVersion) != researchdomain.ConsentVersion {
		return nil, badRequest("请先阅读并同意研究数据授权")
	}
	if input.HasScale && input.ScalePrecisionGrams != nil && (*input.ScalePrecisionGrams <= 0 || *input.ScalePrecisionGrams > 5) {
		return nil, badRequest("请选择秤的精度")
	}
	_, current, err := s.repo.ActiveMembership(ctx, userID, s.now())
	if err != nil {
		return nil, err
	}
	if current != nil && current.ID != campaign.ID {
		return nil, badRequest(fmt.Sprintf("你已加入「%s」，同一时间只能参加一个活动", current.Title))
	}
	source := strings.TrimSpace(input.Source)
	if !slices.Contains(domain.JoinSources, source) {
		source = "code"
	}
	precision := input.ScalePrecisionGrams
	if !input.HasScale {
		precision = nil
	}
	if _, err := s.repo.UpsertMember(ctx, &domain.Member{
		ID: uuid.NewString(), CampaignID: campaign.ID, UserID: userID, Role: domain.RoleMember, HasScale: input.HasScale,
		ScalePrecisionGrams: precision, JoinSource: source, Status: domain.MemberActive, JoinedAt: s.now(),
	}); err != nil {
		return nil, err
	}
	logger.Info(ctx, "高校共建活动成员加入", slog.String("campaign_id", campaign.ID), slog.String("user_id", userID), slog.String("join_source", source))
	return s.Mine(ctx, userID)
}

// Mine is the member's campaign home; Campaign is nil when they are in none.
func (s *CampaignService) Mine(ctx context.Context, userID string) (*domain.MineView, error) {
	member, campaign, err := s.repo.ActiveMembership(ctx, userID, s.now())
	if err != nil || campaign == nil {
		return &domain.MineView{Stations: []domain.Station{}}, err
	}
	view, err := s.view(ctx, campaign)
	if err != nil {
		return nil, err
	}
	stats, err := s.repo.MemberStats(ctx, campaign.ID)
	if err != nil {
		return nil, err
	}
	mine := domain.MemberStats{UserID: userID, Role: member.Role, HasScale: member.HasScale}
	for _, row := range stats {
		if row.UserID == userID {
			mine = row
		}
	}
	stations, err := s.repo.ListStations(ctx, campaign.ID, s.today())
	if err != nil {
		return nil, err
	}
	return &domain.MineView{Campaign: view, Role: member.Role, HasScale: member.HasScale, Stats: mine, Stations: stations}, nil
}

// MembersBoard ranks a campaign's members by approved weighed samples.
// Members of the campaign see nicknames; everyone else sees masked names.
func (s *CampaignService) MembersBoard(ctx context.Context, code, viewerID string) ([]domain.BoardEntry, error) {
	campaign, err := s.campaignByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	stats, err := s.repo.MemberStats(ctx, campaign.ID)
	if err != nil {
		return nil, err
	}
	insider := false
	for _, row := range stats {
		insider = insider || (viewerID != "" && row.UserID == viewerID)
	}
	board := make([]domain.BoardEntry, 0, len(stats))
	for _, row := range stats {
		if row.Approved == 0 {
			continue
		}
		name := displayName(row.Nickname)
		if !insider {
			name = maskName(name)
		}
		board = append(board, domain.BoardEntry{Name: name, Approved: row.Approved})
	}
	return ranked(board), nil
}

// maskName keeps the first character: "王小明" becomes "王同学".
func maskName(name string) string {
	runes := []rune(strings.TrimSpace(name))
	if len(runes) == 0 {
		return "匿名同学"
	}
	return string(runes[0]) + "同学"
}

// CampaignsBoard ranks the active campaigns across schools.
func (s *CampaignService) CampaignsBoard(ctx context.Context) ([]domain.BoardEntry, error) {
	board, err := s.repo.CampaignsBoard(ctx, s.now())
	if err != nil {
		return nil, err
	}
	for index := range board {
		if board[index].Members > 0 {
			board[index].PerMember = math.Round(float64(board[index].Approved)/float64(board[index].Members)*10) / 10
		}
	}
	return ranked(board), nil
}

func ranked(board []domain.BoardEntry) []domain.BoardEntry {
	for index := range board {
		board[index].Rank = index + 1
		if index > 0 && board[index].Approved == board[index-1].Approved {
			board[index].Rank = board[index-1].Rank
		}
	}
	return board
}

func displayName(nickname string) string {
	if strings.TrimSpace(nickname) == "" {
		return "匿名同学"
	}
	return nickname
}

// --- leaders ---------------------------------------------------------------------

func (s *CampaignService) Leader(ctx context.Context, leaderID, campaignID string) (*domain.LeaderView, error) {
	campaign, err := s.leaderCampaign(ctx, leaderID, campaignID)
	if err != nil {
		return nil, err
	}
	view, err := s.view(ctx, campaign)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.MemberStats(ctx, campaign.ID)
	if err != nil {
		return nil, err
	}
	stations, err := s.repo.ListStations(ctx, campaign.ID, campaign.StartsAt.Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	core := 0
	for _, member := range members {
		if member.Role == domain.RoleCore {
			core++
		}
	}
	return &domain.LeaderView{Campaign: view, CoreCap: campaign.CoreMemberCap, CoreCount: core, Members: members, Stations: stations}, nil
}

// SetCore marks or unmarks a core member. Marking grants membership until
// the campaign ends, once per member; unmarking stops no granted days.
func (s *CampaignService) SetCore(ctx context.Context, leaderID, campaignID, userID string, core bool) (*domain.LeaderView, error) {
	campaign, err := s.leaderCampaign(ctx, leaderID, campaignID)
	if err != nil {
		return nil, err
	}
	target, err := s.repo.GetMember(ctx, campaign.ID, userID)
	if err != nil {
		return nil, err
	}
	if target == nil || target.Status != domain.MemberActive {
		return nil, notFound("成员不存在或已退出")
	}
	if target.Role == domain.RoleLeader && !core {
		return nil, badRequest("负责人不能取消")
	}
	if !core {
		if target.Role == domain.RoleCore {
			if err := s.repo.SetRole(ctx, campaign.ID, userID, domain.RoleMember, nil, nil); err != nil {
				return nil, err
			}
		}
		return s.Leader(ctx, leaderID, campaignID)
	}
	if target.Role == domain.RoleMember {
		marked, err := s.repo.MarkCore(ctx, campaign.ID, userID, leaderID, campaign.CoreMemberCap, s.now())
		if err != nil {
			return nil, err
		}
		if !marked {
			return nil, badRequest(fmt.Sprintf("核心成员最多%d人（已开过会员的也算在内）", campaign.CoreMemberCap))
		}
	}
	if err := s.grantMembership(ctx, campaign, target); err != nil {
		return nil, err
	}
	return s.Leader(ctx, leaderID, campaignID)
}

// grantMembership gives a core member (or leader) membership until the
// campaign ends. The source key makes it once per member and campaign.
func (s *CampaignService) grantMembership(ctx context.Context, campaign *domain.Campaign, member *domain.Member) error {
	// Draft or ended campaigns grant nothing; activation grants the people
	// marked before it started.
	if member.MembershipGrantedAt != nil || s.membership == nil || !s.open(campaign) {
		return nil
	}
	days := grantDays(s.now(), campaign.EndsAt)
	plan := strings.TrimSpace(campaign.MembershipPlanCode)
	if plan == "" {
		plan = domain.DefaultMembershipPlan
	}
	key := fmt.Sprintf("campus_campaign:%s:%s", campaign.ID, member.UserID)
	if err := s.membership.GrantCampusCampaignMembership(ctx, member.UserID, key, plan, days, map[string]any{"campaign_id": campaign.ID, "title": campaign.Title}); err != nil {
		return err
	}
	logger.Info(ctx, "高校共建核心成员会员已发放", slog.String("campaign_id", campaign.ID), slog.String("user_id", member.UserID), slog.Int("days", days))
	return s.repo.MarkMembershipGranted(ctx, campaign.ID, member.UserID, days, s.now())
}

// grantDays covers the rest of the campaign, rounded up, within bounds.
func grantDays(now, ends time.Time) int {
	days := int(math.Ceil(ends.Sub(now).Hours() / 24))
	return min(max(days, 1), domain.MaxGrantDays)
}

type StationInput struct {
	SessionDate         string  `json:"session_date"`
	MealPeriod          string  `json:"meal_period"`
	Kind                string  `json:"kind"`
	LocationText        string  `json:"location_text"`
	CanteenID           string  `json:"canteen_id"`
	CatalogItemID       string  `json:"catalog_item_id"`
	ScalePrecisionGrams float64 `json:"scale_precision_grams"`
	Notes               string  `json:"notes"`
}

func (s *CampaignService) CreateStation(ctx context.Context, leaderID, campaignID string, input StationInput) (*domain.Station, error) {
	campaign, err := s.leaderCampaign(ctx, leaderID, campaignID)
	if err != nil {
		return nil, err
	}
	date, err := time.ParseInLocation(time.DateOnly, strings.TrimSpace(input.SessionDate), chinaTime)
	if err != nil {
		return nil, badRequest("请选择称重日的日期")
	}
	day := date.Format(time.DateOnly)
	if day < campaign.StartsAt.In(chinaTime).Format(time.DateOnly) || day > campaign.EndsAt.In(chinaTime).Format(time.DateOnly) {
		return nil, badRequest("称重日需在活动时间内")
	}
	if !slices.Contains(domain.MealPeriods, input.MealPeriod) {
		return nil, badRequest("请选择餐次")
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = domain.StationWeigh
	}
	if kind != domain.StationWeigh && kind != domain.StationSameDish {
		return nil, badRequest("称重日类型不正确")
	}
	precision := input.ScalePrecisionGrams
	if precision <= 0 || precision > 5 {
		return nil, badRequest("请选择秤的精度")
	}
	location, notes := strings.TrimSpace(input.LocationText), strings.TrimSpace(input.Notes)
	if location == "" || len([]rune(location)) > 60 || len([]rune(notes)) > 200 {
		return nil, badRequest("请填写不超过60字的地点")
	}
	station := &domain.Station{
		ID: uuid.NewString(), CampaignID: campaign.ID, CreatedByUserID: leaderID, LocationText: location,
		SessionDate: day, MealPeriod: input.MealPeriod, Kind: kind, ScalePrecisionGrams: precision,
		Notes: notes, Status: "open",
	}
	if id := strings.TrimSpace(input.CatalogItemID); id != "" {
		item, err := s.campusDish(ctx, campaign, id)
		if err != nil {
			return nil, err
		}
		station.CatalogItemID, station.CanteenID = &id, item.CanteenID
	} else if kind == domain.StationSameDish {
		return nil, badRequest("同菜多份请先选是哪道菜")
	}
	if id := strings.TrimSpace(input.CanteenID); id != "" && station.CanteenID == nil {
		station.CanteenID = &id
	}
	if err := s.repo.CreateStation(ctx, station); err != nil {
		return nil, err
	}
	return station, nil
}

// --- photo-estimated meals ----------------------------------------------------------

type RecordLinkInput struct {
	FoodRecordID  string `json:"food_record_id"`
	CatalogItemID string `json:"catalog_item_id"`
	CanteenID     string `json:"canteen_id"`
	WindowID      string `json:"window_id"`
	DishName      string `json:"dish_name"`
	UserAdjusted  bool   `json:"user_adjusted"`
}

// LinkRecord attaches a member's saved food record to the campaign and the
// canteen dish. The grams stay a model estimate.
func (s *CampaignService) LinkRecord(ctx context.Context, userID string, input RecordLinkInput) (bool, error) {
	_, campaign, err := s.repo.ActiveMembership(ctx, userID, s.now())
	if err != nil {
		return false, err
	}
	if campaign == nil {
		return false, nil
	}
	recordID := strings.TrimSpace(input.FoodRecordID)
	if uuid.Validate(recordID) != nil {
		return false, badRequest("记录不存在")
	}
	ref, err := s.repo.FoodRecordForUser(ctx, recordID, userID)
	if err != nil {
		return false, err
	}
	if ref == nil {
		return false, notFound("记录不存在")
	}
	record := &domain.Record{
		ID: uuid.NewString(), CampaignID: campaign.ID, UserID: userID, FoodRecordID: recordID, AnalysisTaskID: ref.SourceTaskID,
		ExecutionMode: ref.ExecutionMode, LabelSource: domain.LabelModelEstimate, DishName: truncate(strings.TrimSpace(input.DishName), 60),
	}
	if input.UserAdjusted {
		record.LabelSource = domain.LabelUserAdjusted
	}
	if ref.TotalWeightGrams > 0 {
		grams := float64(ref.TotalWeightGrams)
		record.EstimatedTotalGrams = &grams
	}
	if id := strings.TrimSpace(input.CatalogItemID); id != "" {
		item, err := s.campusDish(ctx, campaign, id)
		if err != nil {
			return false, err
		}
		record.CatalogItemID, record.CanteenID, record.WindowID = &id, item.CanteenID, item.WindowID
		if record.DishName == "" {
			record.DishName = item.Name
		}
	} else {
		record.CanteenID, record.WindowID = optionalUUID(input.CanteenID), optionalUUID(input.WindowID)
	}
	return s.repo.CreateRecord(ctx, record)
}

// --- research sample attribution ------------------------------------------------------

type SampleAttributionInput struct {
	StationSessionID   string
	CatalogItemID      string
	PairedFoodRecordID string
}

type SampleAttribution struct {
	CampaignID         string
	Channel            string
	StationSessionID   *string
	CanteenID          *string
	CatalogItemID      *string
	PairedFoodRecordID *string
}

// AttributeSample decides a weighed sample's campaign and channel from the
// contributor's active campaign. Nil means the personal channel.
func (s *CampaignService) AttributeSample(ctx context.Context, userID string, input SampleAttributionInput) (*SampleAttribution, error) {
	_, campaign, err := s.repo.ActiveMembership(ctx, userID, s.now())
	if err != nil || campaign == nil {
		return nil, err
	}
	result := &SampleAttribution{CampaignID: campaign.ID, Channel: domain.ChannelSelfScale}
	if id := strings.TrimSpace(input.StationSessionID); id != "" {
		if uuid.Validate(id) != nil {
			return nil, badRequest("称重日不存在")
		}
		station, err := s.repo.GetStation(ctx, id)
		if err != nil {
			return nil, err
		}
		if station == nil || station.CampaignID != campaign.ID {
			return nil, badRequest("称重日不属于你参加的活动")
		}
		if station.Status != "open" || !s.recentDay(station.SessionDate) {
			return nil, badRequest("这个称重日已经过了，请回活动页重新选择")
		}
		result.StationSessionID, result.CanteenID, result.CatalogItemID = &station.ID, station.CanteenID, station.CatalogItemID
		result.Channel = domain.ChannelStation
		if station.Kind == domain.StationSameDish {
			result.Channel = domain.ChannelSameDish
		}
	}
	if id := strings.TrimSpace(input.CatalogItemID); id != "" && result.CatalogItemID == nil {
		item, err := s.campusDish(ctx, campaign, id)
		if err != nil {
			return nil, err
		}
		result.CatalogItemID, result.CanteenID = &id, item.CanteenID
	}
	if id := strings.TrimSpace(input.PairedFoodRecordID); id != "" {
		if uuid.Validate(id) != nil {
			return nil, badRequest("关联的饮食记录不存在")
		}
		ref, err := s.repo.FoodRecordForUser(ctx, id, userID)
		if err != nil {
			return nil, err
		}
		if ref == nil {
			return nil, badRequest("关联的饮食记录不存在")
		}
		result.PairedFoodRecordID = &id
	}
	return result, nil
}

// --- administration --------------------------------------------------------------------

type OrgInput struct {
	SchoolID         string `json:"school_id"`
	CampusID         string `json:"campus_id"`
	Name             string `json:"name"`
	AgreementVersion string `json:"agreement_version"`
	Note             string `json:"note"`
}

func (s *CampaignService) CreateOrg(ctx context.Context, adminID string, input OrgInput) (*domain.Org, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return nil, badRequest("请填写不超过40字的社团名称")
	}
	school := strings.TrimSpace(input.SchoolID)
	if uuid.Validate(school) != nil {
		return nil, badRequest("请选择学校")
	}
	schoolName, err := s.repo.SchoolName(ctx, school)
	if err != nil {
		return nil, err
	}
	if schoolName == "" {
		return nil, badRequest("学校不存在")
	}
	org := &domain.Org{
		ID: uuid.NewString(), SchoolID: school, CampusID: optionalUUID(input.CampusID), Name: name, OrgType: domain.OrgFitnessClub,
		Status: "active", AgreementVersion: truncate(strings.TrimSpace(input.AgreementVersion), 40), Note: truncate(strings.TrimSpace(input.Note), 300),
		CreatedByAdminID: adminID,
	}
	if version := org.AgreementVersion; version != "" {
		now := s.now()
		org.AgreementSignedAt = &now
	}
	if err := s.repo.CreateOrg(ctx, org); err != nil {
		if isUniqueViolation(err) {
			return nil, badRequest("这所学校已有同名社团")
		}
		return nil, err
	}
	return org, nil
}

func (s *CampaignService) ListOrgs(ctx context.Context) ([]domain.Org, error) {
	return s.repo.ListOrgs(ctx)
}

type CampaignInput struct {
	OrgID              string         `json:"org_id"`
	Title              string         `json:"title"`
	StartsAt           time.Time      `json:"starts_at"`
	EndsAt             time.Time      `json:"ends_at"`
	Status             string         `json:"status"`
	CoreMemberCap      *int           `json:"core_member_cap"`
	MembershipPlanCode string         `json:"membership_plan_code"`
	Goals              map[string]any `json:"goals"`
	ClubRewardNote     string         `json:"club_reward_note"`
	LeaderUserIDs      []string       `json:"leader_user_ids"`
}

func (s *CampaignService) CreateCampaign(ctx context.Context, adminID string, input CampaignInput) (*domain.CampaignView, error) {
	org, err := s.repo.GetOrg(ctx, strings.TrimSpace(input.OrgID))
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, badRequest("请先选择社团")
	}
	campaign := &domain.Campaign{
		ID: uuid.NewString(), OrgID: org.ID, SchoolID: org.SchoolID, Status: domain.CampaignDraft,
		CoreMemberCap: domain.DefaultCoreMemberCap, MembershipPlanCode: domain.DefaultMembershipPlan, Goals: map[string]any{},
		CreatedByAdminID: adminID,
	}
	if err := applyCampaignInput(campaign, input); err != nil {
		return nil, err
	}
	for attempt := 0; ; attempt++ {
		campaign.JoinCode, err = newJoinCode()
		if err != nil {
			return nil, err
		}
		err = s.repo.CreateCampaign(ctx, campaign)
		if err == nil || !isUniqueViolation(err) || attempt >= 4 {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	for _, leader := range input.LeaderUserIDs {
		if err := s.AddLeader(ctx, campaign.ID, leader); err != nil {
			return nil, err
		}
	}
	logger.Info(ctx, "高校共建活动已创建", slog.String("campaign_id", campaign.ID), slog.String("org_id", org.ID), slog.String("admin_id", adminID))
	return s.view(ctx, campaign)
}

func applyCampaignInput(campaign *domain.Campaign, input CampaignInput) error {
	title := strings.TrimSpace(input.Title)
	if title == "" || len([]rune(title)) > 40 {
		return badRequest("请填写不超过40字的活动名称")
	}
	if input.StartsAt.IsZero() || !input.EndsAt.After(input.StartsAt) || input.EndsAt.Sub(input.StartsAt) > 180*24*time.Hour {
		return badRequest("请填写活动起止时间（不超过半年）")
	}
	campaign.Title, campaign.StartsAt, campaign.EndsAt = title, input.StartsAt, input.EndsAt
	if status := strings.TrimSpace(input.Status); status != "" {
		if status != domain.CampaignDraft && status != domain.CampaignActive && status != domain.CampaignEnded {
			return badRequest("活动状态不正确")
		}
		campaign.Status = status
	}
	if input.CoreMemberCap != nil {
		if *input.CoreMemberCap < 0 || *input.CoreMemberCap > 200 {
			return badRequest("核心成员名额需在0到200之间")
		}
		campaign.CoreMemberCap = *input.CoreMemberCap
	}
	if plan := strings.TrimSpace(input.MembershipPlanCode); plan != "" {
		campaign.MembershipPlanCode = plan
	}
	if input.Goals != nil {
		campaign.Goals = input.Goals
	}
	note := strings.TrimSpace(input.ClubRewardNote)
	if len([]rune(note)) > 200 {
		return badRequest("社团奖励说明不超过200字")
	}
	campaign.ClubRewardNote = note
	return nil
}

// UpdateCampaign replaces the editable fields of a campaign.
func (s *CampaignService) UpdateCampaign(ctx context.Context, id string, input CampaignInput) (*domain.CampaignView, error) {
	campaign, err := s.repo.GetCampaign(ctx, id)
	if err != nil {
		return nil, err
	}
	if campaign == nil {
		return nil, notFound("活动不存在")
	}
	wasActive := campaign.Status == domain.CampaignActive
	if err := applyCampaignInput(campaign, input); err != nil {
		return nil, err
	}
	err = s.repo.UpdateCampaign(ctx, id, map[string]any{
		"title": campaign.Title, "starts_at": campaign.StartsAt, "ends_at": campaign.EndsAt, "status": campaign.Status,
		"core_member_cap": campaign.CoreMemberCap, "membership_plan_code": campaign.MembershipPlanCode,
		"goals": goalsJSON(campaign.Goals), "club_reward_note": campaign.ClubRewardNote,
	})
	if err != nil {
		return nil, err
	}
	for _, leader := range input.LeaderUserIDs {
		if err := s.AddLeader(ctx, id, leader); err != nil {
			return nil, err
		}
	}
	if !wasActive && campaign.Status == domain.CampaignActive {
		if err := s.grantWaiting(ctx, campaign); err != nil {
			return nil, err
		}
	}
	return s.view(ctx, campaign)
}

// grantWaiting gives the membership to leaders and core members marked
// before the campaign was opened.
func (s *CampaignService) grantWaiting(ctx context.Context, campaign *domain.Campaign) error {
	members, err := s.repo.UngrantedPrivileged(ctx, campaign.ID)
	if err != nil {
		return err
	}
	for index := range members {
		if err := s.grantMembership(ctx, campaign, &members[index]); err != nil {
			return err
		}
	}
	return nil
}

// AddLeader makes a user the campaign's leader (joining them if needed) and
// grants them the core membership.
func (s *CampaignService) AddLeader(ctx context.Context, campaignID, userID string) error {
	userID = strings.TrimSpace(userID)
	if uuid.Validate(userID) != nil {
		return badRequest("负责人账号不正确")
	}
	campaign, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return err
	}
	if campaign == nil {
		return notFound("活动不存在")
	}
	member, err := s.repo.GetMember(ctx, campaignID, userID)
	if err != nil {
		return err
	}
	if member == nil || member.Status != domain.MemberActive {
		// Upsert only for someone not active: it resets the scale fields.
		member, err = s.repo.UpsertMember(ctx, &domain.Member{
			ID: uuid.NewString(), CampaignID: campaignID, UserID: userID, Role: domain.RoleLeader, JoinSource: "admin",
			Status: domain.MemberActive, JoinedAt: s.now(),
		})
		if err != nil {
			return err
		}
	}
	if member.Role != domain.RoleLeader {
		if err := s.repo.SetRole(ctx, campaignID, userID, domain.RoleLeader, nil, nil); err != nil {
			return err
		}
		member.Role = domain.RoleLeader
	}
	return s.grantMembership(ctx, campaign, member)
}

// ListCampaigns returns campaigns with their member and sample counts.
func (s *CampaignService) ListCampaigns(ctx context.Context, status string) ([]domain.CampaignView, error) {
	campaigns, err := s.repo.ListCampaigns(ctx, strings.TrimSpace(status))
	if err != nil {
		return nil, err
	}
	views := make([]domain.CampaignView, 0, len(campaigns))
	for index := range campaigns {
		view, err := s.view(ctx, &campaigns[index])
		if err != nil {
			return nil, err
		}
		views = append(views, *view)
	}
	return views, nil
}

// --- helpers ---------------------------------------------------------------------------------

var chinaTime = time.FixedZone("CST", 8*3600)

func (s *CampaignService) today() string { return s.now().In(chinaTime).Format(time.DateOnly) }

// recentDay accepts a weighing day of today or yesterday (Beijing time): a
// late-evening session may be submitted after midnight.
func (s *CampaignService) recentDay(day string) bool {
	now := s.now().In(chinaTime)
	return day == now.Format(time.DateOnly) || day == now.AddDate(0, 0, -1).Format(time.DateOnly)
}

func (s *CampaignService) open(campaign *domain.Campaign) bool {
	now := s.now()
	return campaign.Status == domain.CampaignActive && !now.Before(campaign.StartsAt) && now.Before(campaign.EndsAt)
}

func (s *CampaignService) campaignByCode(ctx context.Context, code string) (*domain.Campaign, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" || len(code) > 16 {
		return nil, notFound("活动不存在")
	}
	campaign, err := s.repo.GetCampaignByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if campaign == nil || campaign.Status == domain.CampaignDraft {
		return nil, notFound("活动不存在")
	}
	return campaign, nil
}

func (s *CampaignService) leaderCampaign(ctx context.Context, leaderID, campaignID string) (*domain.Campaign, error) {
	if uuid.Validate(strings.TrimSpace(campaignID)) != nil {
		return nil, notFound("活动不存在")
	}
	campaign, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if campaign == nil {
		return nil, notFound("活动不存在")
	}
	member, err := s.repo.GetMember(ctx, campaign.ID, leaderID)
	if err != nil {
		return nil, err
	}
	if member == nil || member.Status != domain.MemberActive || member.Role != domain.RoleLeader {
		return nil, &commonerrors.AppError{Code: 20003, Message: "只有活动负责人可以操作", HTTPStatus: 403}
	}
	return campaign, nil
}

// campusDish checks that a canteen dish belongs to the campaign's school.
func (s *CampaignService) campusDish(ctx context.Context, campaign *domain.Campaign, id string) (*repo.CatalogItemRef, error) {
	if uuid.Validate(id) != nil {
		return nil, badRequest("菜品不存在")
	}
	item, err := s.repo.CatalogItem(ctx, id)
	if err != nil {
		return nil, err
	}
	if item == nil || item.SchoolID == nil || *item.SchoolID != campaign.SchoolID {
		return nil, badRequest("请选择本校食堂的菜")
	}
	return item, nil
}

func (s *CampaignService) view(ctx context.Context, campaign *domain.Campaign) (*domain.CampaignView, error) {
	schoolName, err := s.repo.SchoolName(ctx, campaign.SchoolID)
	if err != nil {
		return nil, err
	}
	org, err := s.repo.GetOrg(ctx, campaign.OrgID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.MemberCounts(ctx, []string{campaign.ID})
	if err != nil {
		return nil, err
	}
	view := &domain.CampaignView{
		ID: campaign.ID, Title: campaign.Title, JoinCode: campaign.JoinCode, Status: campaign.Status, Open: s.open(campaign),
		StartsAt: campaign.StartsAt, EndsAt: campaign.EndsAt, SchoolID: campaign.SchoolID, SchoolName: schoolName,
		Goals: campaign.Goals, ClubRewardNote: campaign.ClubRewardNote,
		MemberCount: counts[campaign.ID][0], ApprovedCount: counts[campaign.ID][1],
	}
	if view.Goals == nil {
		view.Goals = map[string]any{}
	}
	if org != nil {
		view.OrgName = org.Name
	}
	return view, nil
}

// joinCodeAlphabet leaves out characters people misread (0/O, 1/I/L).
const joinCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newJoinCode() (string, error) {
	code := make([]byte, 6)
	for index := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(joinCodeAlphabet))))
		if err != nil {
			return "", err
		}
		code[index] = joinCodeAlphabet[n.Int64()]
	}
	return string(code), nil
}

// goalsJSON encodes campaign goals for a map update, which does not run the
// field serializer.
func goalsJSON(goals map[string]any) any {
	if goals == nil {
		goals = map[string]any{}
	}
	raw, err := json.Marshal(goals)
	if err != nil {
		raw = []byte("{}")
	}
	return gorm.Expr("?::jsonb", string(raw))
}

func optionalUUID(raw string) *string {
	value := strings.TrimSpace(raw)
	if uuid.Validate(value) != nil {
		return nil
	}
	return &value
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func isUniqueViolation(err error) bool {
	return errors.Is(err, gorm.ErrDuplicatedKey) || strings.Contains(err.Error(), "23505") || strings.Contains(strings.ToLower(err.Error()), "duplicate key")
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

func notFound(message string) error {
	return &commonerrors.AppError{Code: 10001, Message: message, HTTPStatus: 404}
}
