package migration

import (
	"context"
	"fmt"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigrateMealMeetups is the scoped, repeatable migration for this feature.
func MigrateMealMeetups(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.AutoMigrate(&migrationdo.MealMeetupDO{}, &migrationdo.MealMeetupParticipantDO{}, &migrationdo.MealMeetupEventDO{}, &migrationdo.MealMeetupReportDO{}); err != nil {
			return err
		}
		return ensureMealMeetupConstraints(ctx, tx)
	})
}
func ensureMealMeetupConstraints(ctx context.Context, db *gorm.DB) error {
	constraints := [][3]string{
		{"meal_meetups", "meal_meetup_status", "CHECK (status IN ('active','cancelled','hidden'))"},
		{"meal_meetups", "meal_meetup_times", "CHECK (ends_at > starts_at)"},
		{"meal_meetups", "meal_meetup_payment", "CHECK (payment IN ('aa','separate'))"},
		{"meal_meetups", "meal_meetup_meal", "CHECK (meal_type IN ('breakfast','lunch','dinner'))"},
		{"meal_meetups", "meal_meetup_coordinates", "CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))"},
		{"meal_meetups", "meal_meetup_host_fk", "FOREIGN KEY (host_user_id) REFERENCES weapp_user(id) ON DELETE CASCADE"},
		{"meal_meetup_participants", "meal_meetup_participant_status", "CHECK (status IN ('pending','accepted','rejected','withdrawn','left','removed'))"},
		{"meal_meetup_participants", "meal_meetup_participant_meetup_fk", "FOREIGN KEY (meetup_id) REFERENCES meal_meetups(id) ON DELETE CASCADE"},
		{"meal_meetup_participants", "meal_meetup_participant_user_fk", "FOREIGN KEY (user_id) REFERENCES weapp_user(id) ON DELETE CASCADE"},
		{"meal_meetup_events", "meal_meetup_event_meetup_fk", "FOREIGN KEY (meetup_id) REFERENCES meal_meetups(id) ON DELETE CASCADE"},
		{"meal_meetup_reports", "meal_meetup_report_meetup_fk", "FOREIGN KEY (meetup_id) REFERENCES meal_meetups(id) ON DELETE CASCADE"},
		{"meal_meetup_reports", "meal_meetup_report_event_fk", "FOREIGN KEY (event_id) REFERENCES meal_meetup_events(id) ON DELETE CASCADE"},
	}
	for _, c := range constraints {
		sql := fmt.Sprintf("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '%s' AND conrelid = '%s'::regclass) THEN ALTER TABLE %s ADD CONSTRAINT %s %s; END IF; END $$", c[1], c[0], c[0], c[1], c[2])
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("约饭约束 %s: %w", c[1], err)
		}
	}
	return nil
}
