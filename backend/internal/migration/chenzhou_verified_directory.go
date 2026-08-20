package migration

import (
	"context"

	"gorm.io/gorm"
)

const (
	chenzhouVerifiedDiningBatchName = "郴州高校官方食堂楼层确认集-20260820"
	chenzhouVerifiedDiningSeedPath  = "data/chenzhou_verified_dining_seed_20260820.json"
)

var chenzhouVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  chenzhouVerifiedDiningBatchName,
	SeedPath:   chenzhouVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20郴州高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectChenzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, chenzhouVerifiedDiningSpec)
}

func PublishChenzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	return PublishVerifiedDiningBatch(ctx, db, schema, chenzhouVerifiedDiningSpec)
}
