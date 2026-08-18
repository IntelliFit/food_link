package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	qinhuangdaoVerifiedDiningBatchName = "秦皇岛高校官方食堂楼层确认集-20260818"
	qinhuangdaoVerifiedDiningSeedPath  = "data/qinhuangdao_verified_dining_seed_20260818.json"
)

var qinhuangdaoVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  qinhuangdaoVerifiedDiningBatchName,
	SeedPath:   qinhuangdaoVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18秦皇岛高校官方来源楼层及当前状态复核通过",
}

func InspectQinhuangdaoVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, qinhuangdaoVerifiedDiningSpec)
}

func PublishQinhuangdaoVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, qinhuangdaoVerifiedDiningSpec)
}
