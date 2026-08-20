package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	zhuzhouVerifiedDiningBatchName = "株洲高校官方食堂楼层确认集-20260820"
	zhuzhouVerifiedDiningSeedPath  = "data/zhuzhou_verified_dining_seed_20260820.json"
)

var zhuzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  zhuzhouVerifiedDiningBatchName,
	SeedPath:   zhuzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20株洲高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectZhuzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, zhuzhouVerifiedDiningSpec)
}

func PublishZhuzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, zhuzhouVerifiedDiningSpec)
}
