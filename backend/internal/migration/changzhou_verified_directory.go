package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	changzhouVerifiedDiningBatchName = "常州高校官方食堂楼层确认集-20260816"
	changzhouVerifiedDiningSeedPath  = "data/changzhou_verified_dining_seed_20260816.json"
)

var changzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  changzhouVerifiedDiningBatchName,
	SeedPath:   changzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16常州高校官方来源楼层及当前状态复核通过",
}

func InspectChangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, changzhouVerifiedDiningSpec)
}

func PublishChangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, changzhouVerifiedDiningSpec)
}
