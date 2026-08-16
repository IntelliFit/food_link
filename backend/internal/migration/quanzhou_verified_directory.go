package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	quanzhouVerifiedDiningBatchName = "泉州高校官方食堂楼层确认集-20260816"
	quanzhouVerifiedDiningSeedPath  = "data/quanzhou_verified_dining_seed_20260816.json"
)

var quanzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  quanzhouVerifiedDiningBatchName,
	SeedPath:   quanzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16泉州高校官方来源楼层及当前状态复核通过",
}

func InspectQuanzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, quanzhouVerifiedDiningSpec)
}

func PublishQuanzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, quanzhouVerifiedDiningSpec)
}
