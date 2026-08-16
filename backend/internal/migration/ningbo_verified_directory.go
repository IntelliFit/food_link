package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	ningboVerifiedDiningBatchName = "宁波高校官方食堂楼层确认集-20260816"
	ningboVerifiedDiningSeedPath  = "data/ningbo_verified_dining_seed_20260816.json"
)

var ningboVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  ningboVerifiedDiningBatchName,
	SeedPath:   ningboVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16宁波高校官方来源楼层复核通过",
}

func InspectNingboVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, ningboVerifiedDiningSpec)
}

func PublishNingboVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, ningboVerifiedDiningSpec)
}
