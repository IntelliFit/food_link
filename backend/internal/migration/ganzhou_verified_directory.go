package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	ganzhouVerifiedDiningBatchName = "赣州高校官方食堂楼层确认集-20260816"
	ganzhouVerifiedDiningSeedPath  = "data/ganzhou_verified_dining_seed_20260816.json"
)

var ganzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  ganzhouVerifiedDiningBatchName,
	SeedPath:   ganzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16赣州高校官方来源楼层及当前状态复核通过",
}

func InspectGanzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, ganzhouVerifiedDiningSpec)
}

func PublishGanzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, ganzhouVerifiedDiningSpec)
}
