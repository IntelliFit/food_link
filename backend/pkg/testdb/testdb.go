// Package testdb provides an ephemeral PostgreSQL database for tests using
// embedded-postgres. It avoids the CGO dependency of go-sqlite3 and the
// schema-dialect mismatch between SQLite and PostgreSQL.
package testdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var (
	mu        sync.Mutex
	server    *embeddedpostgres.EmbeddedPostgres
	baseDSN   string
	initErr   error
	serverDir string
	watcher   io.Closer

	// runtimeRoot overrides where runtime directories go, so tests can isolate
	// them from sweeps by other test processes while sharing the binaries.
	runtimeRoot string
)

// baseDirs returns the shared cache/binary directories and a per-process runtime directory.
func baseDirs(port int) (cacheDir, binDir, runtimeDir string) {
	root := filepath.Join(testTempDir(), "embedded-postgres-go")
	cacheDir = filepath.Join(root, "cache")
	binDir = filepath.Join(root, "bin")
	if runtimeRoot != "" {
		root = runtimeRoot
	}
	runtimeDir = filepath.Join(root, fmt.Sprintf("pg-%d-%d", os.Getpid(), port))
	return
}

func testTempDir() string {
	for _, name := range []string{"FOODLINK_TEST_TMPDIR", "GOTMPDIR"} {
		if dir := os.Getenv(name); filepath.IsAbs(dir) {
			return dir
		}
	}

	// go env -w settings are not inherited by the test executable.
	goEnv := os.Getenv("GOENV")
	if goEnv == "" {
		if configDir, err := os.UserConfigDir(); err == nil {
			goEnv = filepath.Join(configDir, "go", "env")
		}
	}
	if goEnv != "" && goEnv != "off" {
		if config, err := os.ReadFile(goEnv); err == nil {
			for _, line := range strings.Split(string(config), "\n") {
				if dir, ok := strings.CutPrefix(strings.TrimSpace(line), "GOTMPDIR="); ok && filepath.IsAbs(dir) {
					return dir
				}
			}
		}
	}
	return os.TempDir()
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

	// In the background: removing many old directories must not stall this test.
	go sweepAndReport(filepath.Dir(runtimeDir), binDir)

	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		initErr = fmt.Errorf("failed to create embedded postgres runtime dir: %w", err)
		return
	}

	// Before the server starts, so a process killed during initdb is covered.
	// Without a watcher this run can still leak, and the next sweep collects it.
	ownerWatcher, err := spawnWatcher(binDir, dataDir, runtimeDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testdb: %v\n", err)
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

	started := embeddedpostgres.NewDatabase(cfg)
	if initErr = started.Start(); initErr != nil {
		closeWatcher(ownerWatcher)
		_ = removeDir(runtimeDir)
		return
	}

	server = started
	serverDir = runtimeDir
	watcher = ownerWatcher
	baseDSN = fmt.Sprintf("host=localhost port=%d user=postgres password=postgres dbname=postgres sslmode=disable", port)
}

func closeWatcher(w io.Closer) {
	if w != nil {
		_ = w.Close()
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// New starts the shared embedded postgres server if it is not running and creates
// a fresh database for the calling test. The returned *gorm.DB is configured
// against a real PostgreSQL-compatible database, so production schema tags and
// defaults work unchanged. The server goes away with this process; see
// startWatcher.
func New(t *testing.T) *gorm.DB {
	t.Helper()

	mu.Lock()
	if server == nil && initErr == nil {
		startServer()
	}
	serverDSN, startErr := baseDSN, initErr
	mu.Unlock()
	if startErr != nil {
		t.Fatalf("failed to start embedded postgres: %v", startErr)
	}

	dbName := "test_" + uuid.New().String()[:8]

	admin, err := sql.Open("postgres", serverDSN)
	if err != nil {
		t.Fatalf("failed to open postgres admin connection: %v", err)
	}
	defer admin.Close()

	if _, err := admin.ExecContext(context.Background(), "CREATE DATABASE "+dbName); err != nil {
		t.Fatalf("failed to create test database %s: %v", dbName, err)
	}

	dsn := serverDSN + " dbname=" + dbName
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test database %s: %v", dbName, err)
	}

	return db
}

// Stop terminates the shared embedded postgres server and deletes its data
// without waiting for this process to exit. Tests do not need to call it. It is
// safe to call multiple times, and a later New starts a new server.
func Stop() error {
	mu.Lock()
	defer mu.Unlock()
	if server == nil {
		return nil
	}

	stopErr := server.Stop()
	removeErr := removeDir(serverDir)
	closeWatcher(watcher)
	server, baseDSN, serverDir, watcher = nil, "", "", nil
	return errors.Join(stopErr, removeErr)
}
