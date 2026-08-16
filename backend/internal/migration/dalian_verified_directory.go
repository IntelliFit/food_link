package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	dalianVerifiedDiningBatchName = "大连高校官方食堂楼层确认集-20260816"
	dalianVerifiedDiningSeedPath  = "data/dalian_verified_dining_seed_20260816.json"
)

var dalianVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  dalianVerifiedDiningBatchName,
	SeedPath:   dalianVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16大连高校官方来源楼层及当前状态复核通过",
}

func InspectDalianVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, dalianVerifiedDiningSpec)
}

func PublishDalianVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, dalianVerifiedDiningSpec)
}
