package domain

import (
	"math"
	"time"
)

// DietLocation is request-scoped. It is never written to the health profile or chat metadata.
// Coordinates use the same GCJ-02 convention as the mini-program food map.
type DietLocation struct {
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	AccuracyM      float64 `json:"accuracy_m,omitempty"`
	CapturedAt     int64   `json:"captured_at"`
	CoordinateType string  `json:"coordinate_type"`
}

func (l *DietLocation) Valid(now time.Time) bool {
	return l != nil && l.CoordinateType == "gcj02" &&
		!math.IsNaN(l.Latitude) && !math.IsNaN(l.Longitude) &&
		l.Latitude >= -90 && l.Latitude <= 90 && l.Longitude >= -180 && l.Longitude <= 180 &&
		!(l.Latitude == 0 && l.Longitude == 0) && l.AccuracyM >= 0 && l.AccuracyM <= 3000 &&
		l.CapturedAt > 0 && l.CapturedAt <= now.Add(time.Minute).UnixMilli() && l.CapturedAt >= now.Add(-30*time.Minute).UnixMilli()
}
