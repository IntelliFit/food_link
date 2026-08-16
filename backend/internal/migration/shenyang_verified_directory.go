package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	shenyangVerifiedDiningBatchName = "沈阳高校官方食堂楼层确认集-20260816"
	shenyangVerifiedDiningSeedPath  = "data/shenyang_verified_dining_seed_20260816.json"
)

var shenyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  shenyangVerifiedDiningBatchName,
	SeedPath:   shenyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16沈阳高校官方来源楼层及当前状态复核通过",
}

func InspectShenyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, shenyangVerifiedDiningSpec)
}

func PublishShenyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, shenyangVerifiedDiningSpec)
}
