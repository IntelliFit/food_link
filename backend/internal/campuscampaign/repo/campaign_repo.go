package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/campuscampaign/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CampaignRepo struct{ db *gorm.DB }

func NewCampaignRepo(db *gorm.DB) *CampaignRepo { return &CampaignRepo{db: db} }

// --- clubs and campaigns ----------------------------------------------------

func (r *CampaignRepo) CreateOrg(ctx context.Context, org *domain.Org) error {
	return r.db.WithContext(ctx).Create(org).Error
}

func (r *CampaignRepo) GetOrg(ctx context.Context, id string) (*domain.Org, error) {
	var org domain.Org
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&org).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &org, err
}

// ListOrgs lists clubs with their school and how many campaigns they ran,
// optionally for one school.
func (r *CampaignRepo) ListOrgs(ctx context.Context, schoolID string) ([]domain.OrgView, error) {
	query := `SELECT o.id, o.school_id, coalesce(s.name, '') AS school_name, o.name, o.status, o.agreement_version, o.created_at,
  (SELECT count(*) FROM campus_campaigns c WHERE c.org_id = o.id) AS campaign_count
FROM campus_orgs o LEFT JOIN schools s ON s.id = o.school_id`
	args := []any{}
	if schoolID != "" {
		query += ` WHERE o.school_id = ?::uuid`
		args = append(args, schoolID)
	}
	var orgs []domain.OrgView
	err := r.db.WithContext(ctx).Raw(query+` ORDER BY o.created_at DESC LIMIT 500`, args...).Scan(&orgs).Error
	return orgs, err
}

// DeleteOrg removes a club that never ran a campaign; it reports whether a
// row was deleted.
func (r *CampaignRepo) DeleteOrg(ctx context.Context, id string) (bool, error) {
	result := r.db.WithContext(ctx).Exec(`DELETE FROM campus_orgs o WHERE o.id = ?::uuid
AND NOT EXISTS (SELECT 1 FROM campus_campaigns c WHERE c.org_id = o.id)`, id)
	return result.RowsAffected > 0, result.Error
}

func (r *CampaignRepo) CreateCampaign(ctx context.Context, campaign *domain.Campaign) error {
	return r.db.WithContext(ctx).Create(campaign).Error
}

func (r *CampaignRepo) UpdateCampaign(ctx context.Context, id string, updates map[string]any) error {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.Campaign{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *CampaignRepo) GetCampaign(ctx context.Context, id string) (*domain.Campaign, error) {
	return r.firstCampaign(ctx, "id = ?", id)
}

func (r *CampaignRepo) GetCampaignByCode(ctx context.Context, code string) (*domain.Campaign, error) {
	return r.firstCampaign(ctx, "join_code = ?", code)
}

func (r *CampaignRepo) firstCampaign(ctx context.Context, where string, arg any) (*domain.Campaign, error) {
	var campaign domain.Campaign
	err := r.db.WithContext(ctx).Where(where, arg).First(&campaign).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &campaign, err
}

func (r *CampaignRepo) ListCampaigns(ctx context.Context, status string) ([]domain.Campaign, error) {
	query := r.db.WithContext(ctx).Order("starts_at DESC").Limit(500)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var campaigns []domain.Campaign
	err := query.Find(&campaigns).Error
	return campaigns, err
}

// SchoolName returns the directory name of a school, or "" when unknown.
func (r *CampaignRepo) SchoolName(ctx context.Context, schoolID string) (string, error) {
	var names []string
	err := r.db.WithContext(ctx).Raw(`SELECT name FROM schools WHERE id = ?::uuid`, schoolID).Scan(&names).Error
	if err != nil || len(names) == 0 {
		return "", err
	}
	return names[0], nil
}

// --- members ------------------------------------------------------------------

// ActiveMembership returns the user's membership in a campaign that is
// active and inside its window at now, or nil.
func (r *CampaignRepo) ActiveMembership(ctx context.Context, userID string, now time.Time) (*domain.Member, *domain.Campaign, error) {
	var members []domain.Member
	err := r.db.WithContext(ctx).Table("campus_campaign_members AS m").Select("m.*").
		Joins("JOIN campus_campaigns AS c ON c.id = m.campaign_id").
		Where("m.user_id = ? AND m.status = ? AND c.status = ? AND c.starts_at <= ? AND c.ends_at > ?", userID, domain.MemberActive, domain.CampaignActive, now, now).
		Order("m.joined_at DESC").Limit(1).Find(&members).Error
	if err != nil || len(members) == 0 {
		return nil, nil, err
	}
	campaign, err := r.GetCampaign(ctx, members[0].CampaignID)
	return &members[0], campaign, err
}

func (r *CampaignRepo) GetMember(ctx context.Context, campaignID, userID string) (*domain.Member, error) {
	var member domain.Member
	err := r.db.WithContext(ctx).Where("campaign_id = ? AND user_id = ?", campaignID, userID).First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &member, err
}

// UpsertMember adds a member, or reactivates one who left; the role a leader
// gave stays.
func (r *CampaignRepo) UpsertMember(ctx context.Context, member *domain.Member) (*domain.Member, error) {
	now := time.Now()
	member.UpdatedAt = &now
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "campaign_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{"status": domain.MemberActive, "has_scale": member.HasScale, "scale_precision_grams": member.ScalePrecisionGrams, "updated_at": now}),
	}).Create(member).Error
	if err != nil {
		return nil, err
	}
	return r.GetMember(ctx, member.CampaignID, member.UserID)
}

// SetRole changes a member's role inside the campaign.
func (r *CampaignRepo) SetRole(ctx context.Context, campaignID, userID, role string, markedBy *string, at *time.Time) error {
	result := r.db.WithContext(ctx).Model(&domain.Member{}).
		Where("campaign_id = ? AND user_id = ? AND status = ?", campaignID, userID, domain.MemberActive).
		Updates(map[string]any{"role": role, "core_marked_by": markedBy, "core_marked_at": at, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// MarkCore makes an active member a core member within the campaign's quota.
// Slots count current core members and everyone who already received the
// membership, so unmarking never frees a slot, and the advisory lock keeps
// two leaders from both taking the last one. It reports whether the member
// is core afterwards.
func (r *CampaignRepo) MarkCore(ctx context.Context, campaignID, userID, markedBy string, quota int, at time.Time) (bool, error) {
	ok := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext(?))`, "campus_campaign_core:"+campaignID).Error; err != nil {
			return err
		}
		var member domain.Member
		if err := tx.Where("campaign_id = ? AND user_id = ? AND status = ?", campaignID, userID, domain.MemberActive).First(&member).Error; err != nil {
			return err
		}
		if member.Role != domain.RoleMember {
			ok = true
			return nil
		}
		if member.MembershipGrantedAt == nil {
			var used int64
			err := tx.Model(&domain.Member{}).
				Where("campaign_id = ? AND role <> ? AND ((role = ? AND status = ?) OR membership_granted_at IS NOT NULL)", campaignID, domain.RoleLeader, domain.RoleCore, domain.MemberActive).
				Count(&used).Error
			if err != nil || used >= int64(quota) {
				return err
			}
		}
		ok = true
		return tx.Model(&domain.Member{}).Where("id = ?", member.ID).
			Updates(map[string]any{"role": domain.RoleCore, "core_marked_by": markedBy, "core_marked_at": at, "updated_at": time.Now()}).Error
	})
	return ok, err
}

// UngrantedPrivileged lists active leaders and core members still without
// the campaign membership (marked before the campaign started).
func (r *CampaignRepo) UngrantedPrivileged(ctx context.Context, campaignID string) ([]domain.Member, error) {
	var members []domain.Member
	err := r.db.WithContext(ctx).Where("campaign_id = ? AND status = ? AND role IN ? AND membership_granted_at IS NULL",
		campaignID, domain.MemberActive, []string{domain.RoleLeader, domain.RoleCore}).Find(&members).Error
	return members, err
}

func (r *CampaignRepo) MarkMembershipGranted(ctx context.Context, campaignID, userID string, days int, at time.Time) error {
	return r.db.WithContext(ctx).Model(&domain.Member{}).Where("campaign_id = ? AND user_id = ?", campaignID, userID).
		Updates(map[string]any{"membership_granted_at": at, "membership_grant_days": days, "updated_at": time.Now()}).Error
}

// CountRole counts active members holding a role.
func (r *CampaignRepo) CountRole(ctx context.Context, campaignID, role string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.Member{}).
		Where("campaign_id = ? AND role = ? AND status = ?", campaignID, role, domain.MemberActive).Count(&count).Error
	return count, err
}

// MemberCounts returns active members and approved weighed samples of each
// campaign, by campaign ID.
func (r *CampaignRepo) MemberCounts(ctx context.Context, campaignIDs []string) (map[string][2]int64, error) {
	result := map[string][2]int64{}
	if len(campaignIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		CampaignID string
		Members    int64
		Approved   int64
	}
	err := r.db.WithContext(ctx).Raw(`SELECT c.id AS campaign_id,
  (SELECT count(*) FROM campus_campaign_members m WHERE m.campaign_id = c.id AND m.status = 'active') AS members,
  (SELECT count(*) FROM research_weight_samples s WHERE s.campaign_id = c.id AND s.status = 'approved' AND s.quality_tier IN ('A','B')) AS approved
FROM campus_campaigns c WHERE c.id IN ?`, campaignIDs).Scan(&rows).Error
	for _, row := range rows {
		result[row.CampaignID] = [2]int64{row.Members, row.Approved}
	}
	return result, err
}

// MemberStats lists active members with their contributions, most approved
// samples first.
func (r *CampaignRepo) MemberStats(ctx context.Context, campaignID string) ([]domain.MemberStats, error) {
	var rows []domain.MemberStats
	err := r.db.WithContext(ctx).Raw(`SELECT m.user_id, coalesce(u.nickname, '') AS nickname, m.role, m.has_scale,
  coalesce(s.submitted, 0) AS submitted, coalesce(s.approved, 0) AS approved, coalesce(rec.photo_records, 0) AS photo_records,
  (m.membership_granted_at IS NOT NULL) AS membership_set
FROM campus_campaign_members m
LEFT JOIN weapp_user u ON u.id = m.user_id
LEFT JOIN (SELECT user_id, count(*) AS submitted, count(*) FILTER (WHERE status = 'approved' AND quality_tier IN ('A','B')) AS approved
           FROM research_weight_samples WHERE campaign_id = ? GROUP BY user_id) s ON s.user_id = m.user_id
LEFT JOIN (SELECT user_id, count(*) AS photo_records FROM campus_campaign_records WHERE campaign_id = ? GROUP BY user_id) rec ON rec.user_id = m.user_id
WHERE m.campaign_id = ? AND m.status = 'active'
ORDER BY approved DESC, submitted DESC, m.joined_at ASC
LIMIT 500`, campaignID, campaignID, campaignID).Scan(&rows).Error
	return rows, err
}

// CampaignsBoard ranks the active campaigns by approved weighed samples and
// the number of distinct dishes they weighed.
func (r *CampaignRepo) CampaignsBoard(ctx context.Context, now time.Time) ([]domain.BoardEntry, error) {
	var rows []domain.BoardEntry
	err := r.db.WithContext(ctx).Raw(`SELECT o.name AS name, coalesce(sc.name, '') AS school_name,
  (SELECT count(*) FROM research_weight_samples s WHERE s.campaign_id = c.id AND s.status = 'approved' AND s.quality_tier IN ('A','B')) AS approved,
  (SELECT count(*) FROM campus_campaign_members m WHERE m.campaign_id = c.id AND m.status = 'active') AS members,
  (SELECT count(DISTINCT s.catalog_item_id) FROM research_weight_samples s WHERE s.campaign_id = c.id AND s.status = 'approved' AND s.quality_tier IN ('A','B') AND s.catalog_item_id IS NOT NULL) AS dishes
FROM campus_campaigns c
JOIN campus_orgs o ON o.id = c.org_id
LEFT JOIN schools sc ON sc.id = c.school_id
WHERE c.status = 'active' AND c.starts_at <= ?
ORDER BY approved DESC, dishes DESC
LIMIT 100`, now).Scan(&rows).Error
	return rows, err
}

// --- weighing days --------------------------------------------------------------

func (r *CampaignRepo) CreateStation(ctx context.Context, station *domain.Station) error {
	return r.db.WithContext(ctx).Create(station).Error
}

// stationColumns reads session_date as text: the driver returns a date as a
// timestamp, which the mini program could not compare with today.
const stationColumns = `id, campaign_id, created_by_user_id, canteen_id, location_text, to_char(session_date, 'YYYY-MM-DD') AS session_date,
  meal_period, kind, catalog_item_id, scale_precision_grams, notes, status, created_at`

func (r *CampaignRepo) GetStation(ctx context.Context, id string) (*domain.Station, error) {
	var station domain.Station
	err := r.db.WithContext(ctx).Select(stationColumns).Where("id = ?", id).First(&station).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &station, err
}

// ListStations returns the campaign's weighing days from a date on.
func (r *CampaignRepo) ListStations(ctx context.Context, campaignID, fromDate string) ([]domain.Station, error) {
	var stations []domain.Station
	err := r.db.WithContext(ctx).Select(stationColumns).Where("campaign_id = ? AND session_date >= ?", campaignID, fromDate).
		Order("session_date ASC, created_at ASC").Limit(100).Find(&stations).Error
	return stations, err
}

// --- photo-estimated meals --------------------------------------------------------

// CreateRecord links a food record once; a repeated link is a no-op.
// LinkedRecords lists the member's latest photo records counted in a campaign.
func (r *CampaignRepo) LinkedRecords(ctx context.Context, campaignID, userID string, limit int) ([]domain.LinkedRecord, error) {
	rows := []domain.LinkedRecord{}
	err := r.db.WithContext(ctx).Raw(`
SELECT food_record_id::text AS food_record_id, dish_name
FROM campus_campaign_records
WHERE campaign_id = ?::uuid AND user_id = ?::uuid
ORDER BY created_at DESC
LIMIT ?`, campaignID, userID, limit).Scan(&rows).Error
	return rows, err
}

func (r *CampaignRepo) CreateRecord(ctx context.Context, record *domain.Record) (bool, error) {
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	return result.RowsAffected > 0, result.Error
}

// FoodRecordRef is what a campaign link needs from a saved food record.
type FoodRecordRef struct {
	SourceTaskID     *string
	TotalWeightGrams int
	ExecutionMode    string
	RecordTime       *time.Time
}

// FoodRecordForUser returns the user's own food record with its analysis
// mode, or nil when the record is not theirs.
func (r *CampaignRepo) FoodRecordForUser(ctx context.Context, recordID, userID string) (*FoodRecordRef, error) {
	var rows []FoodRecordRef
	err := r.db.WithContext(ctx).Raw(`SELECT f.source_task_id, f.total_weight_grams, f.record_time,
  coalesce(t.payload->>'execution_mode', '') AS execution_mode
FROM user_food_records f
LEFT JOIN analysis_tasks t ON t.id = f.source_task_id
WHERE f.id = ?::uuid AND f.user_id = ?::uuid`, recordID, userID).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

// SearchDishes lists a school's published canteen dishes whose name contains
// the query (all of them, by name, when the query is empty).
// SearchDishes finds dishes whose name contains the query. When none does
// (students type 水煮牛肉, the menu says 牛肉), it returns the dishes sharing
// the most two-character pieces of the query, marked Close.
func (r *CampaignRepo) SearchDishes(ctx context.Context, schoolID, query string, limit int) ([]domain.DishOption, error) {
	query = likeSafe(query)
	rows, err := r.searchDishes(ctx, schoolID, []string{query}, query, limit)
	if err != nil || len(rows) > 0 {
		return rows, err
	}
	pieces := DishQueryPieces(query)
	if len(pieces) == 0 {
		return rows, nil
	}
	rows, err = r.searchDishes(ctx, schoolID, pieces, query, limit)
	for i := range rows {
		rows[i].Close = true
	}
	return rows, err
}

// searchDishes ranks the school's dishes by how many patterns their name contains.
func (r *CampaignRepo) searchDishes(ctx context.Context, schoolID string, patterns []string, query string, limit int) ([]domain.DishOption, error) {
	rows := []domain.DishOption{}
	hits := strings.TrimSuffix(strings.Repeat("(name ILIKE ?)::int + ", len(patterns)), " + ")
	args := make([]any, 0, len(patterns)+3)
	for _, pattern := range patterns {
		args = append(args, "%"+pattern+"%")
	}
	args = append(args, schoolID, query, limit)
	err := r.db.WithContext(ctx).Raw(`SELECT id, name, canteen_name, floor, window_name FROM (
  SELECT id::text AS id, coalesce(name, '') AS name, coalesce(canteen_name, '') AS canteen_name,
    coalesce(floor, '') AS floor, coalesce(window_name, '') AS window_name, `+hits+` AS hits
  FROM campus_food_catalog_items
  WHERE school_id = ?::uuid AND status = 'published' AND coalesce(name, '') <> ''
) dishes
WHERE hits > 0
ORDER BY hits DESC, (name = ?) DESC, length(name), name
LIMIT ?`, args...).Scan(&rows).Error
	return rows, err
}

// DishQueryPieces splits a dish query into its two-character pieces
// (水煮牛肉 → 水煮, 煮牛, 牛肉); queries of two characters or fewer have none.
func DishQueryPieces(query string) []string {
	runes := []rune(strings.Join(strings.Fields(likeSafe(query)), ""))
	if len(runes) <= 2 {
		return nil
	}
	seen := map[string]bool{}
	pieces := []string{}
	for i := 0; i+1 < len(runes); i++ {
		piece := string(runes[i : i+2])
		if !seen[piece] {
			seen[piece] = true
			pieces = append(pieces, piece)
		}
	}
	return pieces
}

func likeSafe(value string) string {
	return strings.NewReplacer("%", "", "_", "", "\\", "").Replace(strings.TrimSpace(value))
}

// CatalogItemRef is the location of a canteen dish in the directory.
type CatalogItemRef struct {
	SchoolID  *string
	CanteenID *string
	WindowID  *string
	Name      string
}

func (r *CampaignRepo) CatalogItem(ctx context.Context, id string) (*CatalogItemRef, error) {
	var rows []CatalogItemRef
	err := r.db.WithContext(ctx).Raw(`SELECT school_id::text AS school_id, canteen_id::text AS canteen_id, window_id::text AS window_id, name
FROM campus_food_catalog_items WHERE id = ?::uuid`, id).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}
