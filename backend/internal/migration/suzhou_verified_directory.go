package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	suzhouVerifiedDiningBatchName = "苏州高校官方食堂楼层确认集-20260816"
	suzhouVerifiedDiningSeedPath  = "data/suzhou_verified_dining_seed_20260816.json"
)

var suzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  suzhouVerifiedDiningBatchName,
	SeedPath:   suzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16苏州高校官方来源楼层及当前状态复核通过",
}

func InspectSuzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, suzhouVerifiedDiningSpec)
}

func PublishSuzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, suzhouVerifiedDiningSpec)
}
