//go:build !windows

package testdb

import (
	"errors"
	"os"
	"syscall"
	"time"
)

const pgCtlBinary = "pg_ctl"

const watcherScript = `cat >/dev/null
"$FOODLINK_TESTDB_PG_CTL" stop -w -t 30 -m immediate -D "$FOODLINK_TESTDB_DATA" >/dev/null 2>&1
i=0
while [ -e "$FOODLINK_TESTDB_RUNTIME" ] && [ "$i" -lt 60 ]; do
	rm -rf "$FOODLINK_TESTDB_RUNTIME"
	i=$((i + 1))
	sleep 1
done`

func watcherCommand() (string, []string) {
	return "/bin/sh", []string{"-c", watcherScript}
}

// A session of its own keeps Ctrl+C in the test's terminal from killing the
// helper before it has cleaned up.
func watcherProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}

// lookupProcess reports whether pid exists. The details stay empty here, which
// makes the sweep rely on the connection check alone.
func lookupProcess(pid int) (processInfo, bool) {
	err := syscall.Kill(pid, 0)
	return processInfo{}, err == nil || errors.Is(err, syscall.EPERM)
}

func dirCreationTime(os.FileInfo) time.Time {
	return time.Time{}
}
