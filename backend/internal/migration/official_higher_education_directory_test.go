package migration

import "testing"

func TestOfficialHigherEducationSnapshot2026(t *testing.T) {
	snapshot, err := loadOfficialHigherEducationSnapshot()
	if err != nil {
		t.Fatalf("load official higher education snapshot: %v", err)
	}
	if snapshot.SourceVersion != "2026-06-17" {
		t.Fatalf("source version = %q, want 2026-06-17", snapshot.SourceVersion)
	}
	if got := len(snapshot.Institutions); got != 3196 {
		t.Fatalf("institution count = %d, want 3196", got)
	}
	codes := make(map[string]struct{}, len(snapshot.Institutions))
	regular, adult := 0, 0
	for _, institution := range snapshot.Institutions {
		if err := validateOfficialHigherEducationInstitution(institution); err != nil {
			t.Fatalf("invalid institution %#v: %v", institution, err)
		}
		if _, exists := codes[institution.OfficialCode]; exists {
			t.Fatalf("duplicate official code %q", institution.OfficialCode)
		}
		codes[institution.OfficialCode] = struct{}{}
		switch institution.Kind {
		case "regular":
			regular++
		case "adult":
			adult++
		}
	}
	if regular != 2952 || adult != 244 {
		t.Fatalf("regular/adult = %d/%d, want 2952/244", regular, adult)
	}
}
