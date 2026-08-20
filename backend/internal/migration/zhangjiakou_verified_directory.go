package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	zhangjiakouVerifiedDiningBatchName = "张家口高校官方食堂楼层确认集-20260818"
	zhangjiakouVerifiedDiningSeedPath  = "data/zhangjiakou_verified_dining_seed_20260818.json"
)

var zhangjiakouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  zhangjiakouVerifiedDiningBatchName,
	SeedPath:   zhangjiakouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18张家口高校官方来源楼层及当前状态复核通过",
}

func InspectZhangjiakouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, zhangjiakouVerifiedDiningSpec)
}

func PublishZhangjiakouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, zhangjiakouVerifiedDiningSpec)
}
