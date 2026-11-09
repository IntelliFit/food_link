package testdb

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

const (
	pgCtlBinary = "pg_ctl.exe"
	stillActive = 259
)

const watcherScript = `$null = [Console]::In.ReadToEnd(); ` +
	`& $env:FOODLINK_TESTDB_PG_CTL stop -w -t 30 -m immediate -D $env:FOODLINK_TESTDB_DATA *> $null; ` +
	`for ($i = 0; $i -lt 120; $i++) { ` +
	`Remove-Item -LiteralPath $env:FOODLINK_TESTDB_RUNTIME -Recurse -Force -ErrorAction SilentlyContinue; ` +
	`if (-not (Test-Path -LiteralPath $env:FOODLINK_TESTDB_RUNTIME)) { break }; ` +
	`Start-Sleep -Milliseconds 500 }`

func watcherCommand() (string, []string) {
	shell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	return shell, []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", watcherScript}
}

// A console of its own keeps Ctrl+C in the test's console from killing the
// helper before it has cleaned up.
func watcherProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
}

// lookupProcess reports whether pid exists. A process we may not inspect counts
// as existing, with its details left empty.
func lookupProcess(pid int) (processInfo, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return processInfo{}, !errors.Is(err, windows.ERROR_INVALID_PARAMETER)
	}
	defer windows.CloseHandle(handle)

	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err == nil && exitCode != stillActive {
		return processInfo{}, false
	}

	var info processInfo
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err == nil {
		info.start = time.Unix(0, created.Nanoseconds())
	}
	name := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(name))
	if err := windows.QueryFullProcessImageName(handle, 0, &name[0], &size); err == nil {
		info.exe = windows.UTF16ToString(name[:size])
	}
	return info, true
}

func dirCreationTime(info os.FileInfo) time.Time {
	if attrs, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return time.Unix(0, attrs.CreationTime.Nanoseconds())
	}
	return time.Time{}
}
