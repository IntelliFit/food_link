package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	yantaiVerifiedDiningBatchName = "烟台高校官方食堂楼层确认集-20260816"
	yantaiVerifiedDiningSeedPath  = "data/yantai_verified_dining_seed_20260816.json"
)

var yantaiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  yantaiVerifiedDiningBatchName,
	SeedPath:   yantaiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16烟台高校官方来源楼层及当前状态复核通过",
}

func InspectYantaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, yantaiVerifiedDiningSpec)
}

func PublishYantaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, yantaiVerifiedDiningSpec)
}
