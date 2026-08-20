package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	yiyangVerifiedDiningBatchName = "益阳高校官方食堂楼层确认集-20260820"
	yiyangVerifiedDiningSeedPath  = "data/yiyang_verified_dining_seed_20260820.json"
)

var yiyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  yiyangVerifiedDiningBatchName,
	SeedPath:   yiyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20益阳高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectYiyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, yiyangVerifiedDiningSpec)
}

func PublishYiyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, yiyangVerifiedDiningSpec)
}
