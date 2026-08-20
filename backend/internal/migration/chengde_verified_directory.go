package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	chengdeVerifiedDiningBatchName = "承德高校官方食堂楼层确认集-20260818"
	chengdeVerifiedDiningSeedPath  = "data/chengde_verified_dining_seed_20260818.json"
)

var chengdeVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  chengdeVerifiedDiningBatchName,
	SeedPath:   chengdeVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18承德高校官方来源楼层及当前状态复核通过",
}

func InspectChengdeVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, chengdeVerifiedDiningSpec)
}

func PublishChengdeVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, chengdeVerifiedDiningSpec)
}
