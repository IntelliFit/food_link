package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	hengyangVerifiedDiningBatchName = "衡阳高校官方食堂楼层确认集-20260816"
	hengyangVerifiedDiningSeedPath  = "data/hengyang_verified_dining_seed_20260816.json"
)

var hengyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  hengyangVerifiedDiningBatchName,
	SeedPath:   hengyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16衡阳高校官方来源楼层及当前状态复核通过",
}

func InspectHengyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, hengyangVerifiedDiningSpec)
}

func PublishHengyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, hengyangVerifiedDiningSpec)
}
