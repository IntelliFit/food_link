package repo

import (
	"context"
	"errors"
	"time"

	friendrepo "food_link/backend/internal/friend/repo"
	"food_link/backend/internal/mealmeetup/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repo struct{ db *gorm.DB }

func New(db *gorm.DB) *Repo { return &Repo{db: db} }
func (r *Repo) Transaction(ctx context.Context, fn func(*Repo) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(New(tx)) })
}
func (r *Repo) DB() *gorm.DB { return r.db }
func (r *Repo) Get(ctx context.Context, id string, lock bool) (*migrationdo.MealMeetupDO, error) {
	q := r.db.WithContext(ctx)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row migrationdo.MealMeetupDO
	err := q.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repo) ByRequest(ctx context.Context, userID, key string) (*migrationdo.MealMeetupDO, error) {
	var row migrationdo.MealMeetupDO
	err := r.db.WithContext(ctx).First(&row, "host_user_id = ? AND request_id = ?", userID, key).Error
	return &row, err
}
func (r *Repo) Create(ctx context.Context, row *migrationdo.MealMeetupDO) (bool, error) {
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "host_user_id"}, {Name: "request_id"}}, DoNothing: true}).Create(row)
	return result.RowsAffected == 1, result.Error
}
func (r *Repo) SetStatus(ctx context.Context, id, status string, now time.Time) error {
	return r.db.WithContext(ctx).Model(&migrationdo.MealMeetupDO{}).Where("id = ?", id).Updates(map[string]any{"status": status, "updated_at": now}).Error
}
func (r *Repo) Participants(ctx context.Context, id string) ([]migrationdo.MealMeetupParticipantDO, error) {
	rows := []migrationdo.MealMeetupParticipantDO{}
	err := r.db.WithContext(ctx).Where("meetup_id = ?", id).Order("created_at, id").Find(&rows).Error
	return rows, err
}
func (r *Repo) SaveParticipant(ctx context.Context, row *migrationdo.MealMeetupParticipantDO) error {
	return r.db.WithContext(ctx).Save(row).Error
}
func (r *Repo) BlockedIDs(ctx context.Context, userID string) ([]string, error) {
	if userID == "" {
		return []string{}, nil
	}
	return friendrepo.NewFriendRepo(r.db).GetBlockedPairUserIDs(ctx, userID)
}
func (r *Repo) Blocked(ctx context.Context, a, b string) (bool, error) {
	return friendrepo.NewFriendRepo(r.db).IsBlockedEither(ctx, a, b)
}
func (r *Repo) Profiles(ctx context.Context, ids []string) (map[string]domain.Profile, error) {
	rows := []domain.Profile{}
	err := r.db.WithContext(ctx).Table("weapp_user").Select("id AS user_id, COALESCE(nickname, '') AS nickname, COALESCE(avatar, '') AS avatar").Where("id IN ?", ids).Scan(&rows).Error
	out := map[string]domain.Profile{}
	for _, p := range rows {
		out[p.UserID] = p
	}
	return out, err
}
func (r *Repo) List(ctx context.Context, userID string, mine bool, q domain.ListQuery, now time.Time) ([]migrationdo.MealMeetupDO, error) {
	rows := []migrationdo.MealMeetupDO{}
	db := r.db.WithContext(ctx).Model(&migrationdo.MealMeetupDO{})
	if mine {
		db = db.Where("host_user_id = ? OR id IN (SELECT meetup_id FROM meal_meetup_participants WHERE user_id = ?)", userID, userID)
		db = db.Where("status <> 'hidden' OR host_user_id = ? OR id IN (SELECT meetup_id FROM meal_meetup_participants WHERE user_id = ? AND status = 'accepted')", userID, userID)
	} else {
		db = db.Where("status = 'active' AND starts_at > ?", now)
		blocked, err := r.BlockedIDs(ctx, userID)
		if err != nil {
			return nil, err
		}
		if len(blocked) > 0 {
			db = db.Where("host_user_id NOT IN ? AND id NOT IN (SELECT meetup_id FROM meal_meetup_participants WHERE status = 'accepted' AND user_id IN ?)", blocked, blocked)
		}
	}
	if q.Keyword != "" {
		k := "%" + q.Keyword + "%"
		db = db.Where("title ILIKE ? OR venue_name ILIKE ? OR address ILIKE ?", k, k, k)
	}
	if q.MealType != "" {
		db = db.Where("meal_type = ?", q.MealType)
	}
	if q.Budget > 0 {
		db = db.Where("budget <= ?", q.Budget)
	}
	if q.Date != "" {
		zone, err := time.LoadLocation(q.Timezone)
		if err != nil {
			return nil, err
		}
		day, err := time.ParseInLocation("2006-01-02", q.Date, zone)
		if err != nil {
			return nil, err
		}
		db = db.Where("starts_at >= ? AND starts_at < ?", day, day.AddDate(0, 0, 1))
	}
	if q.RadiusKM > 0 && q.Latitude != nil && q.Longitude != nil {
		// Haversine distance from reliable venue coordinates only.
		db = db.Where("latitude IS NOT NULL AND longitude IS NOT NULL AND 6371 * 2 * asin(sqrt(LEAST(1.0, power(sin(radians(latitude - ?) / 2), 2) + cos(radians(?)) * cos(radians(latitude)) * power(sin(radians(longitude - ?) / 2), 2)))) <= ?", *q.Latitude, *q.Latitude, *q.Longitude, q.RadiusKM)
	}
	order := "starts_at ASC, id ASC"
	if mine {
		order = "created_at DESC, id DESC"
	}
	err := db.Order(order).Limit(q.Limit).Offset(q.Offset).Find(&rows).Error
	return rows, err
}
func (r *Repo) EventByRequest(ctx context.Context, id, userID, key string) (*migrationdo.MealMeetupEventDO, error) {
	var row migrationdo.MealMeetupEventDO
	err := r.db.WithContext(ctx).First(&row, "meetup_id = ? AND actor_user_id = ? AND request_id = ?", id, userID, key).Error
	return &row, err
}
func (r *Repo) AddEvent(ctx context.Context, id, userID, kind, content string, key *string, now time.Time) (*migrationdo.MealMeetupEventDO, error) {
	row := &migrationdo.MealMeetupEventDO{ID: uuid.NewString(), MeetupID: id, ActorUserID: userID, Kind: kind, Content: content, RequestID: key, CreatedAt: now}
	return row, r.db.WithContext(ctx).Create(row).Error
}
func (r *Repo) Events(ctx context.Context, id string) ([]migrationdo.MealMeetupEventDO, error) {
	rows := []migrationdo.MealMeetupEventDO{}
	err := r.db.WithContext(ctx).Where("meetup_id = ? AND hidden = false AND kind <> 'application'", id).Order("created_at DESC, id DESC").Limit(50).Find(&rows).Error
	return rows, err
}
func (r *Repo) Event(ctx context.Context, id, eventID string) (*migrationdo.MealMeetupEventDO, error) {
	var row migrationdo.MealMeetupEventDO
	err := r.db.WithContext(ctx).First(&row, "id = ? AND meetup_id = ? AND kind = 'text'", eventID, id).Error
	return &row, err
}
func (r *Repo) CreateReport(ctx context.Context, row *migrationdo.MealMeetupReportDO) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "target_key"}, {Name: "reporter_user_id"}}, DoNothing: true}).Create(row).Error
}
func (r *Repo) Reports(ctx context.Context) ([]migrationdo.MealMeetupReportDO, error) {
	rows := []migrationdo.MealMeetupReportDO{}
	err := r.db.WithContext(ctx).Where("status = 'pending'").Order("created_at").Limit(50).Find(&rows).Error
	return rows, err
}
func (r *Repo) Report(ctx context.Context, id string, lock bool) (*migrationdo.MealMeetupReportDO, error) {
	var row migrationdo.MealMeetupReportDO
	q := r.db.WithContext(ctx)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := q.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repo) ResolveReport(ctx context.Context, row *migrationdo.MealMeetupReportDO, hide bool, now time.Time) error {
	if hide && row.EventID != nil {
		if err := r.db.WithContext(ctx).Model(&migrationdo.MealMeetupEventDO{}).Where("id = ?", *row.EventID).Update("hidden", true).Error; err != nil {
			return err
		}
	}
	status := "dismissed"
	if hide {
		status = "resolved"
	}
	return r.db.WithContext(ctx).Model(row).Updates(map[string]any{"status": status, "updated_at": now}).Error
}
func IsMissing(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }
