package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	yueyangVerifiedDiningBatchName = "岳阳高校官方食堂楼层确认集-20260820"
	yueyangVerifiedDiningSeedPath  = "data/yueyang_verified_dining_seed_20260820.json"
)

var yueyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  yueyangVerifiedDiningBatchName,
	SeedPath:   yueyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20岳阳高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectYueyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, yueyangVerifiedDiningSpec)
}

func PublishYueyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, yueyangVerifiedDiningSpec)
}
