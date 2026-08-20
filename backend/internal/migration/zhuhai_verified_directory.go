package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	zhuhaiVerifiedDiningBatchName = "珠海高校官方食堂楼层确认集-20260818"
	zhuhaiVerifiedDiningSeedPath  = "data/zhuhai_verified_dining_seed_20260818.json"
)

var zhuhaiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  zhuhaiVerifiedDiningBatchName,
	SeedPath:   zhuhaiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18珠海高校官方来源楼层及当前状态复核通过",
}

func InspectZhuhaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, zhuhaiVerifiedDiningSpec)
}

func PublishZhuhaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, zhuhaiVerifiedDiningSpec)
}
