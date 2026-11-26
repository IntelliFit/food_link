package foodmeasure

import "encoding/json"

// FromAny reads a declared measurement out of loosely typed JSON data such as
// an analysis result item. A missing, malformed or invalid measurement is
// reported as absent, so callers fall back to the item's gram weight.
func FromAny(value any) (*Measurement, bool) {
	if value == nil {
		return nil, false
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var measurement Measurement
	if err := json.Unmarshal(raw, &measurement); err != nil || measurement.Validate() != nil {
		return nil, false
	}
	return &measurement, true
}

// Map returns the measurement in the JSON shape analysis items carry it in.
func (m Measurement) Map() map[string]any {
	raw, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// Label is the unit as shown to users and to the models that read their notes.
func (u Unit) Label() string {
	switch u {
	case Gram:
		return "克"
	case Milliliter:
		return "毫升"
	case Piece:
		return "个"
	case Serving:
		return "份"
	default:
		return string(u)
	}
}
