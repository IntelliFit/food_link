// Package domain holds the campus channel: clubs run time-boxed collection
// campaigns, members join with a code, and their weighed samples and
// photo-estimated meals carry the campaign.
package domain

import (
	"time"

	"food_link/backend/internal/migration/do"
)

type Org = do.CampusOrgDO
type Campaign = do.CampusCampaignDO
type Member = do.CampusCampaignMemberDO
type Record = do.CampusCampaignRecordDO
type Station = do.CampusStationSessionDO

const (
	OrgFitnessClub = "fitness_club"

	CampaignDraft  = "draft"
	CampaignActive = "active"
	CampaignEnded  = "ended"

	RoleLeader = "leader"
	RoleCore   = "core"
	RoleMember = "member"

	MemberActive  = "active"
	MemberLeft    = "left"
	MemberRemoved = "removed"

	StationWeigh    = "weigh_station"
	StationSameDish = "same_dish"

	// Research sample channels the campus channel writes.
	ChannelSelfScale = "campus_self_scale"
	ChannelStation   = "campus_station"
	ChannelSameDish  = "campus_same_dish"

	LabelModelEstimate = "model_estimate"
	LabelUserAdjusted  = "user_adjusted"

	DefaultCoreMemberCap  = 15
	DefaultMembershipPlan = "standard_monthly"
	// MembershipSourceType tags the membership grants core members get.
	MembershipSourceType = "campus_campaign_core"
	// MaxGrantDays bounds one grant even for a long campaign.
	MaxGrantDays = 120
)

var (
	MealPeriods = []string{"breakfast", "lunch", "dinner", "other"}
	JoinSources = []string{"qr", "link", "code"}
)

// Attribution is what a weighed sample or a food record inherits from the
// contributor's active campaign.
type Attribution struct {
	CampaignID string
	SchoolID   string
	Role       string
}

// StationRef is a validated weighing day for a sample.
type StationRef struct {
	ID            string
	Kind          string
	CanteenID     *string
	CatalogItemID *string
}

// CampaignView is the public face of a campaign: guests can see it.
type CampaignView struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	JoinCode       string         `json:"join_code"`
	Status         string         `json:"status"`
	Open           bool           `json:"open"`
	StartsAt       time.Time      `json:"starts_at"`
	EndsAt         time.Time      `json:"ends_at"`
	SchoolID       string         `json:"school_id"`
	SchoolName     string         `json:"school_name"`
	OrgName        string         `json:"org_name"`
	Goals          map[string]any `json:"goals"`
	ClubRewardNote string         `json:"club_reward_note"`
	CoreMemberCap  int            `json:"core_member_cap"`
	MemberCount    int64          `json:"member_count"`
	ApprovedCount  int64          `json:"approved_count"`
}

// OrgView is a club as the admin page lists it.
type OrgView struct {
	ID               string     `json:"id"`
	SchoolID         string     `json:"school_id"`
	SchoolName       string     `json:"school_name"`
	Name             string     `json:"name"`
	Status           string     `json:"status"`
	AgreementVersion string     `json:"agreement_version"`
	CampaignCount    int64      `json:"campaign_count"`
	CreatedAt        *time.Time `json:"created_at,omitempty"`
}

// MemberStats counts one member's contributions in a campaign.
type MemberStats struct {
	UserID        string `json:"user_id"`
	Nickname      string `json:"nickname"`
	Role          string `json:"role"`
	HasScale      bool   `json:"has_scale"`
	Submitted     int64  `json:"submitted"`
	Approved      int64  `json:"approved"`
	PhotoRecords  int64  `json:"photo_records"`
	MembershipSet bool   `json:"membership_granted"`
}

// BoardEntry is one row of a leaderboard (members inside a campaign, or
// campaigns across schools).
type BoardEntry struct {
	Rank       int     `json:"rank"`
	Name       string  `json:"name"`
	SchoolName string  `json:"school_name,omitempty"`
	Approved   int64   `json:"approved"`
	Members    int64   `json:"members,omitempty"`
	PerMember  float64 `json:"per_member,omitempty"`
	Dishes     int64   `json:"dishes"`
}

// MineView is the member's own campaign home.
type MineView struct {
	Campaign *CampaignView `json:"campaign"`
	Role     string        `json:"role"`
	HasScale bool          `json:"has_scale"`
	Stats    MemberStats   `json:"stats"`
	Stations []Station     `json:"stations"`
}

// LeaderView is what a club leader manages.
type LeaderView struct {
	Campaign  *CampaignView `json:"campaign"`
	CoreCap   int           `json:"core_cap"`
	CoreCount int           `json:"core_count"`
	Members   []MemberStats `json:"members"`
	Stations  []Station     `json:"stations"`
}

// ContributionCounts is what the research sample store reports per member.
type ContributionCounts struct {
	Submitted int64
	Approved  int64
}
