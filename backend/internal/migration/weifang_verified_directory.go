package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	weifangVerifiedDiningBatchName = "潍坊高校官方食堂楼层确认集-20260816"
	weifangVerifiedDiningSeedPath  = "data/weifang_verified_dining_seed_20260816.json"
)

var weifangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  weifangVerifiedDiningBatchName,
	SeedPath:   weifangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16潍坊高校官方来源楼层及当前状态复核通过",
}

func InspectWeifangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, weifangVerifiedDiningSpec)
}

func PublishWeifangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, weifangVerifiedDiningSpec)
}
