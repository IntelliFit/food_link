package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	guilinVerifiedDiningBatchName = "桂林高校官方食堂楼层确认集-20260816"
	guilinVerifiedDiningSeedPath  = "data/guilin_verified_dining_seed_20260816.json"
)

var guilinVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  guilinVerifiedDiningBatchName,
	SeedPath:   guilinVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16桂林高校官方来源楼层及当前状态复核通过",
}

func InspectGuilinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, guilinVerifiedDiningSpec)
}

func PublishGuilinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, guilinVerifiedDiningSpec)
}
