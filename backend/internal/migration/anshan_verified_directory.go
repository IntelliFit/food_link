package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	anshanVerifiedDiningBatchName = "鞍山高校官方食堂楼层确认集-20260816"
	anshanVerifiedDiningSeedPath  = "data/anshan_verified_dining_seed_20260816.json"
)

var anshanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  anshanVerifiedDiningBatchName,
	SeedPath:   anshanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16鞍山高校官方来源楼层及当前状态复核通过",
}

func InspectAnshanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, anshanVerifiedDiningSpec)
}

func PublishAnshanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, anshanVerifiedDiningSpec)
}
