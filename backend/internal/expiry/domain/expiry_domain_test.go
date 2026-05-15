package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestExpiryItem_Struct(t *testing.T) {
	now := time.Now()
	name := "Milk"
	item := ExpiryItem{
		ID:         "item-1",
		UserID:     "user-1",
		FoodName:   name,
		Category:   "dairy",
		ExpireDate: now,
		Status:     "active",
		CreatedAt:  now,
	}
	assert.Equal(t, "item-1", item.ID)
	assert.Equal(t, "Milk", item.FoodName)
	assert.Equal(t, "food_expiry_items", item.TableName())
}
