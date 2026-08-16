package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	fushunVerifiedDiningBatchName = "抚顺高校官方食堂楼层确认集-20260816"
	fushunVerifiedDiningSeedPath  = "data/fushun_verified_dining_seed_20260816.json"
)

var fushunVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  fushunVerifiedDiningBatchName,
	SeedPath:   fushunVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16抚顺高校官方来源楼层及当前状态复核通过",
}

func InspectFushunVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, fushunVerifiedDiningSpec)
}

func PublishFushunVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, fushunVerifiedDiningSpec)
}
