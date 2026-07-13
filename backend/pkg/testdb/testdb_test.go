package testdb

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestNew(t *testing.T) {
	db := New(t)
	require.NotNil(t, db)

	err := db.AutoMigrate(&testModel{})
	require.NoError(t, err)

	err = db.Create(&testModel{Name: "hello"}).Error
	require.NoError(t, err)

	var found testModel
	err = db.First(&found, "name = ?", "hello").Error
	require.NoError(t, err)
	assert.Equal(t, "hello", found.Name)
}

type testModel struct {
	gorm.Model
	Name string
}
