package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	loudiVerifiedDiningBatchName = "娄底高校官方食堂楼层确认集-20260820"
	loudiVerifiedDiningSeedPath  = "data/loudi_verified_dining_seed_20260820.json"
)

var loudiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  loudiVerifiedDiningBatchName,
	SeedPath:   loudiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20娄底高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectLoudiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, loudiVerifiedDiningSpec)
}

func PublishLoudiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, loudiVerifiedDiningSpec)
}
