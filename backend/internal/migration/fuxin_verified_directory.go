package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	fuxinVerifiedDiningBatchName = "阜新高校官方食堂楼层确认集-20260816"
	fuxinVerifiedDiningSeedPath  = "data/fuxin_verified_dining_seed_20260816.json"
)

var fuxinVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  fuxinVerifiedDiningBatchName,
	SeedPath:   fuxinVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16阜新高校官方来源楼层及当前状态复核通过",
}

func InspectFuxinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, fuxinVerifiedDiningSpec)
}

func PublishFuxinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, fuxinVerifiedDiningSpec)
}
