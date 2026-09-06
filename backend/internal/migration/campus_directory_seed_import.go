package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"gorm.io/gorm"
)

// CampusDirectorySeedStats is a read-only summary of one research seed file.
// The dedicated import command displays it before any database connection.
type CampusDirectorySeedStats struct {
	Batches         int `json:"batches"`
	Schools         int `json:"schools"`
	Campuses        int `json:"campuses"`
	Canteens        int `json:"canteens"`
	ActiveCanteens  int `json:"active_canteens"`
	PendingCanteens int `json:"pending_canteens"`
	Windows         int `json:"windows"`
	ActiveWindows   int `json:"active_windows"`
	PendingWindows  int `json:"pending_windows"`
	Dishes          int `json:"dishes"`
}

// InspectCampusDirectoryResearchSeed validates and summarizes a research seed
// without opening a database connection.
func InspectCampusDirectoryResearchSeed(path string) (CampusDirectorySeedStats, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return CampusDirectorySeedStats{}, fmt.Errorf("read campus directory research seed file %q: %w", path, err)
	}
	var seeds []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return CampusDirectorySeedStats{}, fmt.Errorf("parse campus directory research seed file %q: %w", path, err)
	}
	stats := CampusDirectorySeedStats{Batches: len(seeds)}
	for _, batch := range seeds {
		stats.Schools += len(batch.Schools)
		for _, school := range batch.Schools {
			stats.Campuses += len(school.Campuses)
			stats.Canteens += len(school.Canteens)
			stats.Windows += len(school.Windows)
			stats.Dishes += len(school.Dishes)
			for _, canteen := range school.Canteens {
				if normalizePendingReviewStatus(canteen.ReviewStatus) == "active" {
					stats.ActiveCanteens++
				} else {
					stats.PendingCanteens++
				}
			}
			for _, window := range school.Windows {
				if normalizePendingReviewStatus(window.ReviewStatus) == "active" {
					stats.ActiveWindows++
				} else {
					stats.PendingWindows++
				}
			}
		}
	}
	return stats, nil
}

// ImportCampusDirectoryResearchSeed imports exactly one reviewed research
// seed. Unlike AutoMigrate it performs no unrelated schema or data work.
func ImportCampusDirectoryResearchSeed(ctx context.Context, db *gorm.DB, schema, path string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	if _, err := InspectCampusDirectoryResearchSeed(path); err != nil {
		return err
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	return ensureCampusDirectoryResearchSeedFile(ctx, db, path)
}
