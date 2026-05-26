package service

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var packagedPhotoTimestampRE = regexp.MustCompile(`^IMG_(\d{8}_\d{6})`)

type PackagedPhotoGroup struct {
	ID      string   `json:"id"`
	Session int      `json:"session"`
	Files   []string `json:"files"`
}

func ScanPackagedPhotoGroups(inputDir string, sessionGapSec int) ([]PackagedPhotoGroup, error) {
	inputDir = strings.TrimSpace(inputDir)
	if inputDir == "" {
		return nil, fmt.Errorf("input dir is required")
	}
	entries, err := os.ReadDir(inputDir)
	if err != nil {
		return nil, fmt.Errorf("read input dir: %w", err)
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
			continue
		}
		paths = append(paths, filepath.Join(inputDir, entry.Name()))
	}
	sort.Strings(paths)
	return GroupPackagedPhotoPaths(paths, sessionGapSec), nil
}

func GroupPackagedPhotoPaths(paths []string, sessionGapSec int) []PackagedPhotoGroup {
	if len(paths) == 0 {
		return nil
	}
	if sessionGapSec <= 0 {
		sessionGapSec = 90
	}
	sessions := splitPhotoSessions(paths, sessionGapSec)
	groups := make([]PackagedPhotoGroup, 0, len(paths)/2+1)
	groupIndex := 1
	for sessionIdx, session := range sessions {
		for start := 0; start < len(session); {
			end := start + 2
			if end > len(session) {
				end = len(session)
			}
			chunk := append([]string(nil), session[start:end]...)
			groups = append(groups, PackagedPhotoGroup{
				ID:      fmt.Sprintf("group-%03d", groupIndex),
				Session: sessionIdx + 1,
				Files:   chunk,
			})
			groupIndex++
			start = end
		}
	}
	return groups
}

func splitPhotoSessions(paths []string, sessionGapSec int) [][]string {
	sessions := [][]string{}
	current := []string{paths[0]}
	for i := 1; i < len(paths); i++ {
		prevTS, prevOK := parsePackagedPhotoTimestamp(paths[i-1])
		nextTS, nextOK := parsePackagedPhotoTimestamp(paths[i])
		gapSec := sessionGapSec + 1
		if prevOK && nextOK {
			gapSec = int(nextTS.Sub(prevTS).Seconds())
		}
		if gapSec > sessionGapSec {
			sessions = append(sessions, current)
			current = []string{paths[i]}
			continue
		}
		current = append(current, paths[i])
	}
	sessions = append(sessions, current)
	return sessions
}

func parsePackagedPhotoTimestamp(path string) (time.Time, bool) {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	match := packagedPhotoTimestampRE.FindStringSubmatch(base)
	if len(match) != 2 {
		return time.Time{}, false
	}
	ts, err := time.ParseInLocation("20060102_150405", match[1], time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return ts, true
}
