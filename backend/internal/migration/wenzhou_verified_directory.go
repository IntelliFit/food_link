package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	wenzhouVerifiedDiningBatchName = "温州高校官方食堂楼层确认集-20260816"
	wenzhouVerifiedDiningSeedPath  = "data/wenzhou_verified_dining_seed_20260816.json"
)

var wenzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  wenzhouVerifiedDiningBatchName,
	SeedPath:   wenzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16温州高校官方来源楼层及当前状态复核通过",
}

func InspectWenzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, wenzhouVerifiedDiningSpec)
}

func PublishWenzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, wenzhouVerifiedDiningSpec)
}
