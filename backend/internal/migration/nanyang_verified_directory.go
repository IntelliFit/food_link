package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	nanyangVerifiedDiningBatchName = "南阳高校官方食堂楼层确认集-20260816"
	nanyangVerifiedDiningSeedPath  = "data/nanyang_verified_dining_seed_20260816.json"
)

var nanyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  nanyangVerifiedDiningBatchName,
	SeedPath:   nanyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16南阳高校官方来源楼层及当前状态复核通过",
}

func InspectNanyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, nanyangVerifiedDiningSpec)
}

func PublishNanyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, nanyangVerifiedDiningSpec)
}
