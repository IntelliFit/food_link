package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	wuhuVerifiedDiningBatchName = "芜湖高校官方食堂楼层确认集-20260820"
	wuhuVerifiedDiningSeedPath  = "data/wuhu_verified_dining_seed_20260820.json"
)

var wuhuVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  wuhuVerifiedDiningBatchName,
	SeedPath:   wuhuVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20芜湖高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectWuhuVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, wuhuVerifiedDiningSpec)
}

func PublishWuhuVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, wuhuVerifiedDiningSpec)
}
