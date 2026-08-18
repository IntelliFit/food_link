package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	mianyangVerifiedDiningBatchName = "绵阳高校官方食堂楼层确认集-20260818"
	mianyangVerifiedDiningSeedPath  = "data/mianyang_verified_dining_seed_20260818.json"
)

var mianyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  mianyangVerifiedDiningBatchName,
	SeedPath:   mianyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18绵阳高校官方来源楼层及当前状态复核通过",
}

func InspectMianyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, mianyangVerifiedDiningSpec)
}

func PublishMianyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, mianyangVerifiedDiningSpec)
}
