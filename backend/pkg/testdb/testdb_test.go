package testdb

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBaseDirsUsesConfiguredTempDir(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("FOODLINK_TEST_TMPDIR", tempDir)

	cacheDir, binDir, runtimeDir := baseDirs(5433)
	root := filepath.Join(tempDir, "embedded-postgres-go")
	assert.Equal(t, filepath.Join(root, "cache"), cacheDir)
	assert.Equal(t, filepath.Join(root, "bin"), binDir)
	assert.Equal(t, filepath.Join(root, fmt.Sprintf("pg-%d-5433", os.Getpid())), runtimeDir)
}

func TestBaseDirsUsesGoEnvTempDir(t *testing.T) {
	tempDir := t.TempDir()
	goEnv := filepath.Join(t.TempDir(), "env")
	require.NoError(t, os.WriteFile(goEnv, []byte("GOTMPDIR="+tempDir+"\n"), 0o600))
	t.Setenv("FOODLINK_TEST_TMPDIR", "")
	t.Setenv("GOTMPDIR", "")
	t.Setenv("GOENV", goEnv)

	cacheDir, _, _ := baseDirs(5433)
	assert.Equal(t, filepath.Join(tempDir, "embedded-postgres-go", "cache"), cacheDir)
}

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
