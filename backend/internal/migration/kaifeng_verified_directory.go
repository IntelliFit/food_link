package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	kaifengVerifiedDiningBatchName = "开封高校官方食堂楼层确认集-20260816"
	kaifengVerifiedDiningSeedPath  = "data/kaifeng_verified_dining_seed_20260816.json"
)

var kaifengVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  kaifengVerifiedDiningBatchName,
	SeedPath:   kaifengVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16开封高校官方来源楼层及当前状态复核通过",
}

func InspectKaifengVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, kaifengVerifiedDiningSpec)
}

func PublishKaifengVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, kaifengVerifiedDiningSpec)
}
