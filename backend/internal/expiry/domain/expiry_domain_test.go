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
		ID:       "item-1",
		UserID:   "user-1",
		Name:     name,
		Category: "dairy",
		Status:   "active",
		CreatedAt: &now,
	}
	assert.Equal(t, "item-1", item.ID)
	assert.Equal(t, "Milk", item.Name)
	assert.Equal(t, "user_food_expiry_items", item.TableName())
}
