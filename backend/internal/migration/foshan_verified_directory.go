package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	foshanVerifiedDiningBatchName = "佛山高校官方食堂楼层确认集-20260818"
	foshanVerifiedDiningSeedPath  = "data/foshan_verified_dining_seed_20260818.json"
)

var foshanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  foshanVerifiedDiningBatchName,
	SeedPath:   foshanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18佛山高校官方来源楼层及当前状态复核通过",
}

func InspectFoshanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, foshanVerifiedDiningSpec)
}

func PublishFoshanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, foshanVerifiedDiningSpec)
}
