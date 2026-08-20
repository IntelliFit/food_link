package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	zhangjiajieVerifiedDiningBatchName = "张家界高校官方食堂楼层确认集-20260820"
	zhangjiajieVerifiedDiningSeedPath  = "data/zhangjiajie_verified_dining_seed_20260820.json"
)

var zhangjiajieVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  zhangjiajieVerifiedDiningBatchName,
	SeedPath:   zhangjiajieVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20张家界高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectZhangjiajieVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, zhangjiajieVerifiedDiningSpec)
}

func PublishZhangjiajieVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, zhangjiajieVerifiedDiningSpec)
}
