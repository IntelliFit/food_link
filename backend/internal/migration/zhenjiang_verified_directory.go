package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	zhenjiangVerifiedDiningBatchName = "镇江高校官方食堂楼层确认集-20260818"
	zhenjiangVerifiedDiningSeedPath  = "data/zhenjiang_verified_dining_seed_20260818.json"
)

var zhenjiangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  zhenjiangVerifiedDiningBatchName,
	SeedPath:   zhenjiangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18镇江高校官方来源楼层及当前状态复核通过",
}

func InspectZhenjiangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, zhenjiangVerifiedDiningSpec)
}

func PublishZhenjiangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, zhenjiangVerifiedDiningSpec)
}
