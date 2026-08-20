package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	changdeVerifiedDiningBatchName = "常德高校官方食堂楼层确认集-20260820"
	changdeVerifiedDiningSeedPath  = "data/changde_verified_dining_seed_20260820.json"
)

var changdeVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  changdeVerifiedDiningBatchName,
	SeedPath:   changdeVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20常德高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectChangdeVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, changdeVerifiedDiningSpec)
}

func PublishChangdeVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, changdeVerifiedDiningSpec)
}
