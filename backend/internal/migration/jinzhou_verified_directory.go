package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	jinzhouVerifiedDiningBatchName = "锦州高校官方食堂楼层确认集-20260816"
	jinzhouVerifiedDiningSeedPath  = "data/jinzhou_verified_dining_seed_20260816.json"
)

var jinzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  jinzhouVerifiedDiningBatchName,
	SeedPath:   jinzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16锦州高校官方来源楼层及当前状态复核通过",
}

func InspectJinzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, jinzhouVerifiedDiningSpec)
}

func PublishJinzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, jinzhouVerifiedDiningSpec)
}
