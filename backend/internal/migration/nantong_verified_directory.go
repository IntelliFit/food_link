package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	nantongVerifiedDiningBatchName = "南通高校官方食堂楼层确认集-20260818"
	nantongVerifiedDiningSeedPath  = "data/nantong_verified_dining_seed_20260818.json"
)

var nantongVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  nantongVerifiedDiningBatchName,
	SeedPath:   nantongVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18南通高校官方来源楼层及当前状态复核通过",
}

func InspectNantongVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, nantongVerifiedDiningSpec)
}

func PublishNantongVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, nantongVerifiedDiningSpec)
}
