package testdb

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	ownerModeEnv   = "FOODLINK_TESTDB_OWNER_MODE"
	ownerRootEnv   = "FOODLINK_TESTDB_OWNER_ROOT"
	ownerReportEnv = "FOODLINK_TESTDB_OWNER_REPORT"

	modePass    = "pass"
	modeFail    = "fail"
	modePanic   = "panic"
	modeExit    = "exit"
	modeHold    = "hold"
	modeOrphan  = "orphan"
	goneTimeout = 90 * time.Second
)

type ownerReport struct {
	RuntimeDir string
	Postmaster int
	Port       int
}

type nopCloser struct{}

func (nopCloser) Close() error { return nil }

// TestOwnerProcess is not a test of its own: the tests below re-run this binary
// to get a real owner process that they can watch exit or kill.
func TestOwnerProcess(t *testing.T) {
	mode := os.Getenv(ownerModeEnv)
	if mode == "" {
		t.Skip("only runs as a child of the orphan tests")
	}

	runtimeRoot = os.Getenv(ownerRootEnv)
	if mode == modeOrphan {
		spawnWatcher = func(string, string, string) (io.Closer, error) { return nopCloser{}, nil }
	}

	db := New(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	pid, port, ok := readPostmasterPID(filepath.Join(serverDir, "data"))
	require.True(t, ok)
	report, err := json.Marshal(ownerReport{RuntimeDir: serverDir, Postmaster: pid, Port: port})
	require.NoError(t, err)
	reportPath := os.Getenv(ownerReportEnv)
	require.NoError(t, os.WriteFile(reportPath+".tmp", report, 0o600))
	require.NoError(t, os.Rename(reportPath+".tmp", reportPath))

	switch mode {
	case modeFail:
		t.Fatal("deliberate failure")
	case modePanic:
		panic("deliberate panic")
	case modeExit:
		os.Exit(3)
	case modeHold:
		_, _ = io.Copy(io.Discard, os.Stdin)
	}
}

// startOwner runs TestOwnerProcess in a child and waits until its database is up.
func startOwner(t *testing.T, root, mode string) (*exec.Cmd, io.WriteCloser, ownerReport) {
	t.Helper()
	reportPath := filepath.Join(t.TempDir(), "report.json")
	cmd := exec.Command(os.Args[0], "-test.run=^TestOwnerProcess$", "-test.count=1")
	cmd.Env = append(os.Environ(), ownerModeEnv+"="+mode, ownerRootEnv+"="+root, ownerReportEnv+"="+reportPath)
	stdin, err := cmd.StdinPipe()
	require.NoError(t, err)
	require.NoError(t, cmd.Start())
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
	})

	var report ownerReport
	require.Eventually(t, func() bool {
		content, err := os.ReadFile(reportPath)
		return err == nil && json.Unmarshal(content, &report) == nil
	}, goneTimeout, 100*time.Millisecond, "owner %s never reported its database", mode)
	return cmd, stdin, report
}

func requireGone(t *testing.T, report ownerReport) {
	t.Helper()
	require.Eventually(t, func() bool {
		_, err := os.Stat(report.RuntimeDir)
		return !isPostgresProcess(report.Postmaster) && os.IsNotExist(err)
	}, goneTimeout, 200*time.Millisecond, "postmaster %d or %s left behind", report.Postmaster, report.RuntimeDir)
}

func requireRunning(t *testing.T, report ownerReport) {
	t.Helper()
	require.True(t, isPostgresProcess(report.Postmaster), "postmaster %d should still run", report.Postmaster)
	require.DirExists(t, filepath.Join(report.RuntimeDir, "data"))
}

// stopLeftover keeps a failing test from leaking the orphan it created on purpose.
func stopLeftover(t *testing.T, report ownerReport, binDir string) {
	t.Helper()
	t.Cleanup(func() {
		if isPostgresProcess(report.Postmaster) {
			_ = exec.Command(filepath.Join(binDir, "bin", pgCtlBinary), "stop", "-w", "-m", "immediate",
				"-D", filepath.Join(report.RuntimeDir, "data")).Run()
		}
	})
}

func sharedBinDir(t *testing.T) string {
	t.Helper()
	cacheDir, binDir, _ := baseDirs(0)
	require.NoError(t, ensureBinaries(cacheDir, binDir))
	return binDir
}

func TestOwnerEndingLeavesNothingBehind(t *testing.T) {
	sharedBinDir(t)

	for _, tc := range []struct {
		name     string
		mode     string
		kill     bool
		exitCode int
	}{
		{name: "tests pass", mode: modePass, exitCode: 0},
		{name: "test fails", mode: modeFail, exitCode: 1},
		{name: "test panics", mode: modePanic, exitCode: 2},
		{name: "os.Exit skips everything", mode: modeExit, exitCode: 3},
		{name: "process is killed", mode: modeHold, kill: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			root := t.TempDir()
			cmd, _, report := startOwner(t, root, tc.mode)

			if tc.kill {
				require.NoError(t, cmd.Process.Kill())
			}
			waitErr := cmd.Wait()
			if !tc.kill {
				assert.Equal(t, tc.exitCode, cmd.ProcessState.ExitCode(), "owner result: %v", waitErr)
			}

			requireGone(t, report)
			entries, err := os.ReadDir(root)
			require.NoError(t, err)
			assert.Empty(t, entries)
		})
	}
}

func TestSweepStopsIdleOrphanButNotOneWithClients(t *testing.T) {
	binDir := sharedBinDir(t)
	root := t.TempDir()
	cmd, _, report := startOwner(t, root, modeOrphan)
	stopLeftover(t, report, binDir)
	require.NoError(t, cmd.Wait())

	// Without the watcher the database outlives its owner, which is the original bug.
	requireRunning(t, report)

	client, err := sql.Open("postgres", fmt.Sprintf("host=localhost port=%d user=postgres password=postgres dbname=postgres sslmode=disable", report.Port))
	require.NoError(t, err)
	defer client.Close()
	require.NoError(t, client.Ping())

	removed, err := sweepOrphans(root, binDir)
	require.NoError(t, err)
	assert.Empty(t, removed)
	requireRunning(t, report)

	require.NoError(t, client.Close())
	require.Eventually(t, func() bool {
		removed, err := sweepOrphans(root, binDir)
		return err == nil && len(removed) == 1
	}, goneTimeout, 200*time.Millisecond)
	requireGone(t, report)
}

func TestSweepLeavesDatabaseOfLiveOwner(t *testing.T) {
	binDir := sharedBinDir(t)
	root := t.TempDir()
	cmd, stdin, report := startOwner(t, root, modeHold)

	// The owner closed its connections, so only its liveness protects the database.
	removed, err := sweepOrphans(root, binDir)
	require.NoError(t, err)
	assert.Empty(t, removed)
	requireRunning(t, report)

	require.NoError(t, stdin.Close())
	require.NoError(t, cmd.Wait())
	requireGone(t, report)
}

func TestSweepRemovesOnlyDeadOwnerDirectories(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")

	finished := exec.Command(os.Args[0], "-test.run=^$")
	require.NoError(t, finished.Run())
	deadPID := finished.Process.Pid

	dead := filepath.Join(root, fmt.Sprintf("pg-%d-5001", deadPID))
	require.NoError(t, os.MkdirAll(filepath.Join(dead, "data"), 0o755))
	stalePID := fmt.Sprintf("%d\n%s\n0\n5001\n", deadPID, dead)
	require.NoError(t, os.WriteFile(filepath.Join(dead, "data", "postmaster.pid"), []byte(stalePID), 0o600))

	kept := []string{
		"bin",
		"cache",
		"bin_extract_data",
		"pg-notapid-5001",
		"pg-1",
		"prefix-pg-" + strconv.Itoa(deadPID) + "-5001",
		fmt.Sprintf("pg-%d-5002", os.Getpid()),
	}
	for _, name := range kept {
		require.NoError(t, os.MkdirAll(filepath.Join(root, name, "marker"), 0o755))
	}

	removed, err := sweepOrphans(root, binDir)
	require.NoError(t, err)
	assert.Equal(t, []string{filepath.Base(dead)}, removed)
	assert.NoDirExists(t, dead)
	for _, name := range kept {
		assert.DirExists(t, filepath.Join(root, name, "marker"))
	}
}

func TestSweepOfMissingRootIsNotAnError(t *testing.T) {
	removed, err := sweepOrphans(filepath.Join(t.TempDir(), "missing"), "")
	require.NoError(t, err)
	assert.Empty(t, removed)
}

func TestOwnerAlive(t *testing.T) {
	finished := exec.Command(os.Args[0], "-test.run=^$")
	require.NoError(t, finished.Run())

	assert.False(t, ownerAlive(finished.Process.Pid, time.Now()), "exited process")
	assert.True(t, ownerAlive(os.Getpid(), time.Now()), "running owner")
	assert.True(t, ownerAlive(os.Getpid(), time.Time{}), "unknown directory age counts as alive")

	if proc, _ := lookupProcess(os.Getpid()); !proc.start.IsZero() {
		assert.False(t, ownerAlive(os.Getpid(), proc.start.Add(-time.Hour)), "PID reused after the directory was made")
	}
}

func TestReadPostmasterPID(t *testing.T) {
	dir := t.TempDir()
	_, _, ok := readPostmasterPID(dir)
	assert.False(t, ok, "missing file")

	path := filepath.Join(dir, "postmaster.pid")
	require.NoError(t, os.WriteFile(path, []byte("123\nE:/data\n1700000000\n5433\n\nlocalhost\n"), 0o600))
	pid, port, ok := readPostmasterPID(dir)
	assert.True(t, ok)
	assert.Equal(t, 123, pid)
	assert.Equal(t, 5433, port)

	require.NoError(t, os.WriteFile(path, []byte("123\n"), 0o600))
	_, _, ok = readPostmasterPID(dir)
	assert.False(t, ok, "truncated file")
}

func TestStopRemovesDataAndAllowsRestart(t *testing.T) {
	require.NoError(t, Stop())
	t.Cleanup(func() { assert.NoError(t, Stop()) })

	require.NotNil(t, New(t))
	firstDir := serverDir
	require.DirExists(t, firstDir)

	require.NoError(t, Stop())
	assert.NoDirExists(t, firstDir)
	require.NoError(t, Stop(), "second Stop")

	db := New(t)
	require.NoError(t, db.Exec("SELECT 1").Error)
	assert.NotEqual(t, firstDir, serverDir)
}
