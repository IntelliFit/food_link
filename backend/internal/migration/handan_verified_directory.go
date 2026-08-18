package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	handanVerifiedDiningBatchName = "邯郸高校官方食堂楼层确认集-20260818"
	handanVerifiedDiningSeedPath  = "data/handan_verified_dining_seed_20260818.json"
)

var handanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  handanVerifiedDiningBatchName,
	SeedPath:   handanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18邯郸高校官方来源楼层及当前状态复核通过",
}

func InspectHandanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, handanVerifiedDiningSpec)
}

func PublishHandanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, handanVerifiedDiningSpec)
}
