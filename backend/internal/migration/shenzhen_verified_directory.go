package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	shenzhenVerifiedDiningBatchName = "深圳高校官方食堂楼层确认集-20260816"
	shenzhenVerifiedDiningSeedPath  = "data/shenzhen_verified_dining_seed_20260816.json"
)

var shenzhenVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  shenzhenVerifiedDiningBatchName,
	SeedPath:   shenzhenVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16深圳高校官方来源楼层复核通过",
}

func InspectShenzhenVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, shenzhenVerifiedDiningSpec)
}

func PublishShenzhenVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, shenzhenVerifiedDiningSpec)
}
