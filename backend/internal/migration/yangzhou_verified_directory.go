package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	yangzhouVerifiedDiningBatchName = "扬州高校官方食堂楼层确认集-20260818"
	yangzhouVerifiedDiningSeedPath  = "data/yangzhou_verified_dining_seed_20260818.json"
)

var yangzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  yangzhouVerifiedDiningBatchName,
	SeedPath:   yangzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18扬州高校官方来源楼层及当前状态复核通过",
}

func InspectYangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, yangzhouVerifiedDiningSpec)
}

func PublishYangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, yangzhouVerifiedDiningSpec)
}
