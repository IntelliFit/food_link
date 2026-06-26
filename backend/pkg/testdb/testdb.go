// Package testdb provides an ephemeral PostgreSQL database for tests using
// embedded-postgres. It avoids the CGO dependency of go-sqlite3 and the
// schema-dialect mismatch between SQLite and PostgreSQL.
package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var (
	once    sync.Once
	server  *embeddedpostgres.EmbeddedPostgres
	baseDSN string
	initErr error
)

// baseDirs returns the shared cache/binary directories and a per-process runtime directory.
func baseDirs(port int) (cacheDir, binDir, runtimeDir string) {
	root := filepath.Join(os.TempDir(), "embedded-postgres-go")
	cacheDir = filepath.Join(root, "cache")
	binDir = filepath.Join(root, "bin")
	runtimeDir = filepath.Join(root, fmt.Sprintf("pg-%d-%d", os.Getpid(), port))
	return
}

// ensureBinaries makes sure the shared Postgres binaries are extracted.
// Concurrent test processes serialize via a lock file so only one process
// downloads/extracts the archive.
func ensureBinaries(cacheDir, binDir string) error {
	postgresBin := filepath.Join(binDir, "bin", "postgres.exe")
	if _, err := os.Stat(postgresBin); err == nil {
		return nil
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return fmt.Errorf("create bin dir: %w", err)
	}

	lockFile := filepath.Join(cacheDir, "extract.lock")
	unlock, err := acquireLock(lockFile, 2*time.Minute)
	if err != nil {
		return fmt.Errorf("acquire extraction lock: %w", err)
	}
	defer unlock()

	// Re-check after acquiring the lock.
	if _, err := os.Stat(postgresBin); err == nil {
		return nil
	}

	// Use a throwaway runtime/data dir just to populate the shared bin dir.
	extractRuntime := binDir + "_extract_runtime"
	extractData := binDir + "_extract_data"
	defer os.RemoveAll(extractRuntime)
	defer os.RemoveAll(extractData)

	port, err := freePort()
	if err != nil {
		return fmt.Errorf("find free port for extraction: %w", err)
	}

	cfg := embeddedpostgres.DefaultConfig().
		Database("postgres").
		Username("postgres").
		Password("postgres").
		Port(uint32(port)).
		CachePath(cacheDir).
		RuntimePath(extractRuntime).
		DataPath(extractData).
		BinariesPath(binDir)

	extractServer := embeddedpostgres.NewDatabase(cfg)
	if err := extractServer.Start(); err != nil {
		return fmt.Errorf("extract embedded postgres binaries: %w", err)
	}
	_ = extractServer.Stop()
	return nil
}

// acquireLock creates an exclusive lock file. It retries until the timeout.
func acquireLock(lockFile string, timeout time.Duration) (func(), error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			return func() {
				_ = f.Close()
				_ = os.Remove(lockFile)
			}, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, fmt.Errorf("timeout waiting for lock %s", lockFile)
}

func startServer() {
	port, err := freePort()
	if err != nil {
		initErr = fmt.Errorf("failed to find free port: %w", err)
		return
	}

	cacheDir, binDir, runtimeDir := baseDirs(port)
	dataDir := filepath.Join(runtimeDir, "data")

	if initErr = ensureBinaries(cacheDir, binDir); initErr != nil {
		return
	}

	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		initErr = fmt.Errorf("failed to create embedded postgres runtime dir: %w", err)
		return
	}

	cfg := embeddedpostgres.DefaultConfig().
		Database("postgres").
		Username("postgres").
		Password("postgres").
		Port(uint32(port)).
		CachePath(cacheDir).
		RuntimePath(runtimeDir).
		DataPath(dataDir).
		BinariesPath(binDir)

	server = embeddedpostgres.NewDatabase(cfg)
	if initErr = server.Start(); initErr != nil {
		return
	}

	baseDSN = fmt.Sprintf("host=localhost port=%d user=postgres password=postgres dbname=postgres sslmode=disable", port)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// New starts the shared embedded postgres server (once per process) and creates
// a fresh database for the calling test. The returned *gorm.DB is configured
// against a real PostgreSQL-compatible database, so production schema tags and
// defaults work unchanged.
func New(t *testing.T) *gorm.DB {
	t.Helper()

	once.Do(startServer)
	if initErr != nil {
		t.Fatalf("failed to start embedded postgres: %v", initErr)
	}

	dbName := "test_" + uuid.New().String()[:8]

	admin, err := sql.Open("postgres", baseDSN)
	if err != nil {
		t.Fatalf("failed to open postgres admin connection: %v", err)
	}
	defer admin.Close()

	if _, err := admin.ExecContext(context.Background(), "CREATE DATABASE "+dbName); err != nil {
		t.Fatalf("failed to create test database %s: %v", dbName, err)
	}

	dsn := baseDSN + " dbname=" + dbName
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test database %s: %v", dbName, err)
	}

	return db
}

// Stop terminates the shared embedded postgres server. Call it from a
// TestMain or package-level cleanup if desired; it is safe to call multiple
// times.
func Stop() error {
	if server == nil {
		return nil
	}
	return server.Stop()
}
