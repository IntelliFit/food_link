package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	yongzhouVerifiedDiningBatchName = "永州高校官方食堂楼层确认集-20260820"
	yongzhouVerifiedDiningSeedPath  = "data/yongzhou_verified_dining_seed_20260820.json"
)

var yongzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  yongzhouVerifiedDiningBatchName,
	SeedPath:   yongzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20永州高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectYongzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, yongzhouVerifiedDiningSpec)
}

func PublishYongzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, yongzhouVerifiedDiningSpec)
}
