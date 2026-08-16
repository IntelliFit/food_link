package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	xiangtanVerifiedDiningBatchName = "湘潭高校官方食堂楼层确认集-20260816"
	xiangtanVerifiedDiningSeedPath  = "data/xiangtan_verified_dining_seed_20260816.json"
)

var xiangtanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  xiangtanVerifiedDiningBatchName,
	SeedPath:   xiangtanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16湘潭高校官方来源楼层及当前状态复核通过",
}

func InspectXiangtanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, xiangtanVerifiedDiningSpec)
}

func PublishXiangtanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, xiangtanVerifiedDiningSpec)
}
