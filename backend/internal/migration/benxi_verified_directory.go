package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	benxiVerifiedDiningBatchName = "本溪高校官方食堂楼层确认集-20260816"
	benxiVerifiedDiningSeedPath  = "data/benxi_verified_dining_seed_20260816.json"
)

var benxiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  benxiVerifiedDiningBatchName,
	SeedPath:   benxiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16本溪高校官方来源楼层及当前状态复核通过",
}

func InspectBenxiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, benxiVerifiedDiningSpec)
}

func PublishBenxiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, benxiVerifiedDiningSpec)
}
