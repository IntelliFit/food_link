package service

import (
	"testing"
	"time"
)

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

func TestNoticeDayStartUsesBeijingTime(t *testing.T) {
	for _, c := range []struct{ now, want string }{
		{"2026-10-30T15:59:00Z", "2026-10-29T16:00:00Z"}, // 23:59 on the 30th in Beijing
		{"2026-10-30T16:01:00Z", "2026-10-30T16:00:00Z"}, // 00:01 on the 31st in Beijing
	} {
		now, err := time.Parse(time.RFC3339, c.now)
		if err != nil {
			t.Fatal(err)
		}
		if got := noticeDayStart(now).UTC().Format(time.RFC3339); got != c.want {
			t.Errorf("noticeDayStart(%s) = %s, want %s", c.now, got, c.want)
		}
	}
}
