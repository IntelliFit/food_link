package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	baodingVerifiedDiningBatchName = "保定高校官方食堂楼层确认集-20260816"
	baodingVerifiedDiningSeedPath  = "data/baoding_verified_dining_seed_20260816.json"
)

var baodingVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  baodingVerifiedDiningBatchName,
	SeedPath:   baodingVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16保定高校官方来源楼层及当前状态复核通过",
}

func InspectBaodingVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, baodingVerifiedDiningSpec)
}

func PublishBaodingVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, baodingVerifiedDiningSpec)
}
