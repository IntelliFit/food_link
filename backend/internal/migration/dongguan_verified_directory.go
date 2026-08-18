package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	dongguanVerifiedDiningBatchName = "东莞高校官方食堂楼层确认集-20260818"
	dongguanVerifiedDiningSeedPath  = "data/dongguan_verified_dining_seed_20260818.json"
)

var dongguanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  dongguanVerifiedDiningBatchName,
	SeedPath:   dongguanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18东莞高校官方来源楼层及当前状态复核通过",
}

func InspectDongguanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, dongguanVerifiedDiningSpec)
}

func PublishDongguanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, dongguanVerifiedDiningSpec)
}
