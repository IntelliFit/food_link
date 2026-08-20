package main

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type testPublicItem struct {
	ID                 string `gorm:"column:id;primaryKey"`
	Status             string `gorm:"column:status"`
	Type               string `gorm:"column:type"`
	IsCampusFood       bool   `gorm:"column:is_campus_food"`
	SchoolID           *string
	CampusID           *string
	CanteenID          *string
	WindowID           *string
	SchoolName         string
	CampusName         string
	CanteenName        string
	Floor              string
	WindowName         string
	CampusLocationText string
	UpdatedAt          time.Time
}

func (testPublicItem) TableName() string { return "public_food_library" }

func TestReclassifyBatchOnlyRemovesCampusLabelsFromTargetBatch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CollectionBatch{}, &domain.CatalogItem{}, &testPublicItem{}))

	targetBatch := domain.CollectionBatch{ID: uuid.NewString(), BatchName: "AI原点社区", VenueType: "office_park"}
	otherBatch := domain.CollectionBatch{ID: uuid.NewString(), BatchName: "高校食堂", VenueType: "university"}
	require.NoError(t, db.Create(&[]domain.CollectionBatch{targetBatch, otherBatch}).Error)
	targetItem := domain.CatalogItem{ID: uuid.NewString(), BatchID: targetBatch.ID, Name: "番茄炒蛋", Status: "published"}
	otherItem := domain.CatalogItem{ID: uuid.NewString(), BatchID: otherBatch.ID, Name: "鸡蛋炒饭", Status: "published"}
	require.NoError(t, db.Create(&[]domain.CatalogItem{targetItem, otherItem}).Error)
	schoolID := uuid.NewString()
	publicItems := []testPublicItem{
		{ID: targetItem.ID, Status: "published", Type: "campus", IsCampusFood: true, SchoolID: &schoolID, SchoolName: "AI原点社区", CampusName: "海淀产业园", CanteenName: "园区食堂", Floor: "1F", CampusLocationText: "AI原点社区"},
		{ID: otherItem.ID, Status: "published", Type: "campus", IsCampusFood: true, SchoolID: &schoolID, SchoolName: "测试大学", CanteenName: "一食堂"},
	}
	require.NoError(t, db.Create(&publicItems).Error)

	batch, candidates, err := auditBatch(context.Background(), db, targetBatch.ID, "office_park")
	require.NoError(t, err)
	require.Equal(t, targetBatch.ID, batch.ID)
	require.Len(t, candidates, 1)
	require.Equal(t, targetItem.ID, candidates[0].ItemID)

	updated, err := reclassifyBatch(context.Background(), db, candidates, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(1), updated)

	var savedTarget, savedOther testPublicItem
	require.NoError(t, db.First(&savedTarget, "id = ?", targetItem.ID).Error)
	require.NoError(t, db.First(&savedOther, "id = ?", otherItem.ID).Error)
	require.Equal(t, "common", savedTarget.Type)
	require.False(t, savedTarget.IsCampusFood)
	require.Nil(t, savedTarget.SchoolID)
	require.Empty(t, savedTarget.SchoolName)
	require.Empty(t, savedTarget.CanteenName)
	require.Empty(t, savedTarget.CampusLocationText)
	require.Equal(t, "campus", savedOther.Type)
	require.True(t, savedOther.IsCampusFood)
}

func TestAuditBatchRejectsUnexpectedVenueType(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CollectionBatch{}, &domain.CatalogItem{}, &testPublicItem{}))
	batch := domain.CollectionBatch{ID: uuid.NewString(), VenueType: "university"}
	require.NoError(t, db.Create(&batch).Error)

	_, _, err = auditBatch(context.Background(), db, batch.ID, "office_park")
	require.ErrorContains(t, err, "expected")
}
