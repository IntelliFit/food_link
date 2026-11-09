package testdb

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// spawnWatcher is a variable so tests can create an orphan on purpose.
var spawnWatcher = startWatcher

// startWatcher starts a helper that stops the database and deletes its runtime
// directory once this process is gone. pg_ctl detaches the postmaster and Go
// has no exit hook, so nothing inside the test process can cover a test binary
// that finishes without TestMain, panics, or is killed.
//
// The helper blocks reading a pipe only this process can write to, so the
// kernel wakes it however this process ends. Closing the returned Closer wakes
// it too. It is a shell rather than a re-exec of the test binary because a
// running image would lock go test's work directory while the helper cleans up.
func startWatcher(binDir, dataDir, runtimeDir string) (io.Closer, error) {
	name, args := watcherCommand()
	cmd := exec.Command(name, args...)
	cmd.Dir = filepath.Dir(runtimeDir)
	cmd.SysProcAttr = watcherProcAttr()
	cmd.Env = append(os.Environ(),
		"FOODLINK_TESTDB_PG_CTL="+filepath.Join(binDir, "bin", pgCtlBinary),
		"FOODLINK_TESTDB_DATA="+dataDir,
		"FOODLINK_TESTDB_RUNTIME="+runtimeDir,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("create watcher pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("start watcher %s: %w", name, err)
	}
	go func() { _ = cmd.Wait() }()
	return stdin, nil
}
