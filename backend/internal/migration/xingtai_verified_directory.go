package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	xingtaiVerifiedDiningBatchName = "邢台高校官方食堂楼层确认集-20260818"
	xingtaiVerifiedDiningSeedPath  = "data/xingtai_verified_dining_seed_20260818.json"
)

var xingtaiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  xingtaiVerifiedDiningBatchName,
	SeedPath:   xingtaiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18邢台高校官方来源楼层及当前状态复核通过",
}

func InspectXingtaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, xingtaiVerifiedDiningSpec)
}

func PublishXingtaiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, xingtaiVerifiedDiningSpec)
}
