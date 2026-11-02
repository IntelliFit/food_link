package testdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	removeTimeout = 10 * time.Second
	// Allows for the different clocks behind process and file timestamps. An
	// owner always starts well before its runtime directory exists.
	pidReuseSlack = time.Second
)

var (
	// Anchored so bin, cache and the extraction directories can never match.
	runtimeDirName  = regexp.MustCompile(`^pg-(\d+)-\d+$`)
	errDatabaseBusy = errors.New("database still has client connections")
)

type processInfo struct {
	start time.Time
	exe   string
}

// sweepOrphans stops and removes databases under root whose owner process is
// gone, for the cases the watcher cannot cover: runs from before it existed, or
// a watcher killed together with its owner. A database with client connections
// is left alone. Removal failures are returned and retried by the next sweep.
func sweepOrphans(root, binDir string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", root, err)
	}

	var removed []string
	var errs []error
	for _, entry := range entries {
		match := runtimeDirName.FindStringSubmatch(entry.Name())
		if match == nil || !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil || ownerAlive(pid, dirCreationTime(info)) {
			continue
		}

		dir := filepath.Join(root, entry.Name())
		if err := reapOrphan(dir, binDir); err != nil {
			if !errors.Is(err, errDatabaseBusy) {
				errs = append(errs, fmt.Errorf("%s: %w", entry.Name(), err))
			}
			continue
		}
		removed = append(removed, entry.Name())
	}
	return removed, errors.Join(errs...)
}

func sweepAndReport(root, binDir string) {
	removed, err := sweepOrphans(root, binDir)
	if len(removed) > 0 {
		fmt.Fprintf(os.Stderr, "testdb: removed %d orphaned databases under %s\n", len(removed), root)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "testdb: orphan sweep under %s: %v\n", root, err)
	}
}

// ownerAlive reports whether the test process that created a runtime directory
// still runs. Windows reuses PIDs quickly, so a process that started after the
// directory was created cannot be its owner. Anything uncertain counts as alive.
func ownerAlive(pid int, dirCreated time.Time) bool {
	proc, exists := lookupProcess(pid)
	if !exists {
		return false
	}
	if proc.start.IsZero() || dirCreated.IsZero() {
		return true
	}
	return !proc.start.After(dirCreated.Add(pidReuseSlack))
}

func reapOrphan(runtimeDir, binDir string) error {
	if err := stopIdlePostmaster(filepath.Join(runtimeDir, "data"), binDir); err != nil {
		return err
	}
	return removeDir(runtimeDir)
}

// stopIdlePostmaster stops the postmaster of dataDir if one is running. It only
// does so after that postmaster has confirmed over SQL that it serves dataDir
// and has no clients, because postmaster.pid can be stale and name a PID or port
// that now belongs to another database.
func stopIdlePostmaster(dataDir, binDir string) error {
	pid, port, ok := readPostmasterPID(dataDir)
	if !ok || !isPostgresProcess(pid) {
		return nil
	}

	if err := checkPostmasterIdle(dataDir, port); err != nil {
		return err
	}
	out, err := exec.Command(filepath.Join(binDir, "bin", pgCtlBinary),
		"stop", "-w", "-t", "30", "-m", "immediate", "-D", dataDir).CombinedOutput()
	if err != nil {
		return fmt.Errorf("pg_ctl stop: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// readPostmasterPID parses the PID and port lines of postmaster.pid.
func readPostmasterPID(dataDir string) (pid, port int, ok bool) {
	content, err := os.ReadFile(filepath.Join(dataDir, "postmaster.pid"))
	if err != nil {
		return 0, 0, false
	}
	lines := strings.Split(string(content), "\n")
	if len(lines) < 4 {
		return 0, 0, false
	}
	pid, pidErr := strconv.Atoi(strings.TrimSpace(lines[0]))
	port, portErr := strconv.Atoi(strings.TrimSpace(lines[3]))
	return pid, port, pidErr == nil && portErr == nil
}

func isPostgresProcess(pid int) bool {
	proc, exists := lookupProcess(pid)
	if !exists {
		return false
	}
	if proc.exe == "" {
		return true
	}
	return strings.EqualFold(strings.TrimSuffix(filepath.Base(proc.exe), ".exe"), "postgres")
}

func checkPostmasterIdle(dataDir string, port int) error {
	db, err := sql.Open("postgres", fmt.Sprintf("host=localhost port=%d user=postgres password=postgres dbname=postgres sslmode=disable connect_timeout=5", port))
	if err != nil {
		return fmt.Errorf("open connection: %w", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var servedDir string
	var clients int
	err = db.QueryRowContext(ctx, `SELECT current_setting('data_directory'),
		(SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())`).
		Scan(&servedDir, &clients)
	if err != nil {
		return fmt.Errorf("check clients on port %d: %w", port, err)
	}

	served, err := os.Stat(servedDir)
	if err != nil {
		return fmt.Errorf("stat served directory: %w", err)
	}
	expected, err := os.Stat(dataDir)
	if err != nil {
		return fmt.Errorf("stat data directory: %w", err)
	}
	if !os.SameFile(served, expected) {
		return fmt.Errorf("port %d serves %s, not %s", port, servedDir, dataDir)
	}
	if clients > 0 {
		return errDatabaseBusy
	}
	return nil
}

// removeDir retries because Windows keeps files locked for a moment after the
// processes holding them exit.
func removeDir(dir string) error {
	deadline := time.Now().Add(removeTimeout)
	for {
		err := os.RemoveAll(dir)
		if err == nil || time.Now().After(deadline) {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
}
