package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	cangzhouVerifiedDiningBatchName = "沧州高校官方食堂楼层确认集-20260818"
	cangzhouVerifiedDiningSeedPath  = "data/cangzhou_verified_dining_seed_20260818.json"
)

var cangzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  cangzhouVerifiedDiningBatchName,
	SeedPath:   cangzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18沧州高校官方来源楼层及当前状态复核通过",
}

func InspectCangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, cangzhouVerifiedDiningSpec)
}

func PublishCangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, cangzhouVerifiedDiningSpec)
}
