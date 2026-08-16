package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	liaoyangVerifiedDiningBatchName = "辽阳高校官方食堂楼层确认集-20260816"
	liaoyangVerifiedDiningSeedPath  = "data/liaoyang_verified_dining_seed_20260816.json"
)

var liaoyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  liaoyangVerifiedDiningBatchName,
	SeedPath:   liaoyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16辽阳高校官方来源楼层及当前状态复核通过",
}

func InspectLiaoyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, liaoyangVerifiedDiningSpec)
}

func PublishLiaoyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, liaoyangVerifiedDiningSpec)
}
