package worker

// precisionPlanSourceType decides whether a precision round plans from text or
// images. Older precision-confirm pages always send source_type=image, even for
// a session that started from text; with no new photo in that round the
// session's own type wins, otherwise a text meal is re-planned as an empty image.
func precisionPlanSourceType(submitted, session string, hasImages bool) string {
	if session == "text" && !hasImages {
		return "text"
	}
	sourceType := submitted
	if sourceType == "" {
		sourceType = session
	}
	if sourceType != "text" {
		return "image"
	}
	return "text"
}
