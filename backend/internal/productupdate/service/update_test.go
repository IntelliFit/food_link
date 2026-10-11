package service

import "testing"

func TestVersionEligibility(t *testing.T) {
	for _, c := range []struct {
		version, minimum string
		want             bool
	}{
		{"4.6.12", "4.6.12", true}, {"4.6.11", "4.6.12", false}, {"4.10.0", "4.9.99", true},
		{"5.0.0", "4.99.99", true}, {"4.6.12-beta", "4.6.12", false}, {"", "4.6.12", false}, {"4.6.12", "04.6.12", false},
	} {
		if got := Eligible(c.version, c.minimum); got != c.want {
			t.Errorf("Eligible(%q,%q) = %v", c.version, c.minimum, got)
		}
	}
}
