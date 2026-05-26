package service

import (
	"path/filepath"
	"testing"
)

func TestGroupPackagedPhotoPaths_PairsWithinSession(t *testing.T) {
	paths := []string{
		filepath.Join("dir", "IMG_20260525_040502.jpg"),
		filepath.Join("dir", "IMG_20260525_040522.jpg"),
		filepath.Join("dir", "IMG_20260525_040551.jpg"),
		filepath.Join("dir", "IMG_20260525_040557.jpg"),
	}
	groups := GroupPackagedPhotoPaths(paths, 90)
	if len(groups) != 2 {
		t.Fatalf("groups=%d want 2", len(groups))
	}
	if len(groups[0].Files) != 2 || len(groups[1].Files) != 2 {
		t.Fatalf("unexpected group sizes: %#v", groups)
	}
	if groups[0].Session != 1 || groups[1].Session != 1 {
		t.Fatalf("unexpected sessions: %#v", groups)
	}
}

func TestGroupPackagedPhotoPaths_SingleRemainder(t *testing.T) {
	paths := []string{
		filepath.Join("dir", "IMG_20260525_040502.jpg"),
		filepath.Join("dir", "IMG_20260525_040522.jpg"),
		filepath.Join("dir", "IMG_20260525_040551.jpg"),
	}
	groups := GroupPackagedPhotoPaths(paths, 90)
	if len(groups) != 2 {
		t.Fatalf("groups=%d want 2", len(groups))
	}
	if len(groups[0].Files) != 2 || len(groups[1].Files) != 1 {
		t.Fatalf("unexpected group sizes: %#v", groups)
	}
}

func TestGroupPackagedPhotoPaths_SessionSplit(t *testing.T) {
	paths := []string{
		filepath.Join("dir", "IMG_20260525_040502.jpg"),
		filepath.Join("dir", "IMG_20260525_040522.jpg"),
		filepath.Join("dir", "IMG_20260525_044955.jpg"),
		filepath.Join("dir", "IMG_20260525_045004.jpg"),
	}
	groups := GroupPackagedPhotoPaths(paths, 90)
	if len(groups) != 2 {
		t.Fatalf("groups=%d want 2", len(groups))
	}
	if groups[0].Session != 1 || groups[1].Session != 2 {
		t.Fatalf("unexpected sessions: %#v", groups)
	}
}
