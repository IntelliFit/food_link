package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	luoyangVerifiedDiningBatchName = "洛阳高校官方食堂楼层确认集-20260816"
	luoyangVerifiedDiningSeedPath  = "data/luoyang_verified_dining_seed_20260816.json"
)

var luoyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  luoyangVerifiedDiningBatchName,
	SeedPath:   luoyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16洛阳高校官方来源楼层及当前状态复核通过",
}

func InspectLuoyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, luoyangVerifiedDiningSpec)
}

func PublishLuoyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, luoyangVerifiedDiningSpec)
}
