package migration

import (
	"context"
	"database/sql"
	"go/ast"
	"go/parser"
	"go/token"
	"sync"
	"testing"
	"time"

	"github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var registerSQLiteNow sync.Once

func openMigrationSQLiteWithNow(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	registerSQLiteNow.Do(func() {
		sql.Register("sqlite3-with-now", &sqlite3.SQLiteDriver{ConnectHook: func(conn *sqlite3.SQLiteConn) error {
			return conn.RegisterFunc("now", func() string { return time.Now().UTC().Format("2006-01-02 15:04:05") }, true)
		}})
	})
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite3-with-now", DSN: dsn}, &gorm.Config{})
	require.NoError(t, err)
	return db
}

func TestAutoMigrateDoesNotPublishReviewedCampusDirectory(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "migration.go", nil, 0)
	require.NoError(t, err)

	called := map[string]bool{}
	foundAutoMigrate := false
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != "AutoMigrate" {
			continue
		}
		foundAutoMigrate = true
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			identifier, ok := call.Fun.(*ast.Ident)
			if ok {
				called[identifier.Name] = true
			}
			return true
		})
	}

	require.True(t, foundAutoMigrate)
	assert.False(t, called["ensureBeijingOwnerVerifiedDiningSeed"])
	assert.False(t, called["ensureVerifiedDiningDirectoryPublication"])
	assert.False(t, called["ensureCampusDirectoryPendingResearchSeed"])
	assert.False(t, called["PublishBeijingOwnerVerifiedDiningDirectory"])
	assert.False(t, called["PublishVerifiedDiningDirectory"])
}

func TestPendingCampusDirectoryImportPreservesReviewedBatchStatus(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:pending-campus-batch-status?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE campus_directory_import_batches (
			id TEXT PRIMARY KEY DEFAULT 'generated-id',
			name TEXT NOT NULL UNIQUE,
			region TEXT,
			source_scope TEXT,
			status TEXT NOT NULL,
			total_schools INTEGER NOT NULL DEFAULT 0,
			total_campuses INTEGER NOT NULL DEFAULT 0,
			total_canteens INTEGER NOT NULL DEFAULT 0,
			total_windows INTEGER NOT NULL DEFAULT 0,
			total_sources INTEGER NOT NULL DEFAULT 0,
			notes TEXT,
			created_by TEXT,
			reviewed_by TEXT,
			reviewed_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO campus_directory_import_batches (id, name, status)
		VALUES ('batch-1', '南京高校目录', 'approved')
	`).Error)

	seed := campusDirectoryPendingResearchSeed{
		BatchName: "南京高校目录",
		Region:    "江苏省南京市",
		Schools: []campusDirectoryResearchItem{
			{School: "南京大学", Campuses: []campusDirectoryResearchCampus{{Name: "鼓楼校区"}}},
		},
	}
	batchID, err := ensureCampusDirectoryPendingBatch(context.Background(), db, seed)
	require.NoError(t, err)
	assert.Equal(t, "batch-1", batchID)

	var saved struct {
		Status        string
		TotalSchools  int
		TotalCampuses int
	}
	require.NoError(t, db.Table("campus_directory_import_batches").Where("id = ?", batchID).Take(&saved).Error)
	assert.Equal(t, "approved", saved.Status)
	assert.Equal(t, 1, saved.TotalSchools)
	assert.Equal(t, 1, saved.TotalCampuses)
}

func TestPendingCampusDirectoryImportPreservesApprovedSource(t *testing.T) {
	db := openMigrationSQLiteWithNow(t, "file:pending-campus-source-status?mode=memory&cache=shared")
	require.NoError(t, db.Exec(`
		CREATE TABLE campus_directory_sources (
			id TEXT PRIMARY KEY,
			batch_id TEXT,
			school_id TEXT NOT NULL,
			campus_id TEXT,
			canteen_id TEXT,
			source_url TEXT NOT NULL,
			source_title TEXT,
			source_org TEXT,
			source_type TEXT,
			evidence_level TEXT,
			evidence_excerpt TEXT,
			review_status TEXT NOT NULL,
			updated_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO campus_directory_sources (
			id, batch_id, school_id, canteen_id, source_url, evidence_level, review_status
		) VALUES ('source-1', 'approved-batch', 'school-1', 'canteen-1', 'https://example.edu/canteen', 'A', 'approved')
	`).Error)

	canteenID := "canteen-1"
	err := ensureCampusDirectoryPendingSource(
		context.Background(),
		db,
		"pending-batch",
		"school-1",
		nil,
		&canteenID,
		campusDirectoryResearchCanteen{
			SourceURL:     "https://example.edu/canteen",
			SourceTitle:   "聚合资料",
			EvidenceLevel: "D",
		},
	)
	require.NoError(t, err)

	var saved struct {
		BatchID       string
		EvidenceLevel string
		ReviewStatus  string
	}
	require.NoError(t, db.Table("campus_directory_sources").Where("id = ?", "source-1").Take(&saved).Error)
	assert.Equal(t, "approved-batch", saved.BatchID)
	assert.Equal(t, "A", saved.EvidenceLevel)
	assert.Equal(t, "approved", saved.ReviewStatus)
}

func TestPendingCampusDirectoryImportDoesNotDowngradeBetterCanteenResearch(t *testing.T) {
	db := openMigrationSQLiteWithNow(t, "file:pending-campus-canteen-confidence?mode=memory&cache=shared")
	require.NoError(t, db.Exec(`
		CREATE TABLE schools (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			status TEXT NOT NULL
		);
		CREATE TABLE school_canteens (
			id TEXT PRIMARY KEY DEFAULT 'generated-canteen',
			school_id TEXT NOT NULL,
			campus_id TEXT,
			name TEXT NOT NULL,
			aliases TEXT NOT NULL DEFAULT '[]',
			location_text TEXT,
			building_or_floor TEXT,
			service_type TEXT,
			audience TEXT,
			meal_periods TEXT NOT NULL DEFAULT '[]',
			opening_hours_raw TEXT,
			payment_methods TEXT NOT NULL DEFAULT '[]',
			halal_or_ethnic INTEGER,
			visitor_available INTEGER,
			source_url TEXT,
			source_org TEXT,
			source_type TEXT,
			confidence_level TEXT,
			status TEXT NOT NULL,
			review_note TEXT,
			reviewed_by TEXT,
			reviewed_at DATETIME,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME,
			UNIQUE (school_id, name)
		);
		CREATE TABLE campus_directory_sources (
			canteen_id TEXT,
			evidence_level TEXT,
			review_status TEXT
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO schools (id, name, status) VALUES ('school-1', '南京大学', 'active');
		INSERT INTO school_canteens (
			id, school_id, name, location_text, confidence_level, status
		) VALUES ('canteen-1', 'school-1', '学生第一餐厅', '权威资料地址', 'A', 'pending_review')
	`).Error)

	err := ensureCampusDirectoryPendingSchoolResearch(
		context.Background(),
		db,
		"pending-batch",
		campusDirectoryResearchItem{
			School: "南京大学",
			Canteens: []campusDirectoryResearchCanteen{
				{
					Name:          "学生第一餐厅",
					LocationText:  "聚合资料地址",
					EvidenceLevel: "D",
					ReviewStatus:  "pending_review",
				},
			},
		},
	)
	require.NoError(t, err)

	var saved struct {
		LocationText    string
		ConfidenceLevel string
	}
	require.NoError(t, db.Table("school_canteens").Where("id = ?", "canteen-1").Take(&saved).Error)
	assert.Equal(t, "权威资料地址", saved.LocationText)
	assert.Equal(t, "A", saved.ConfidenceLevel)
}
