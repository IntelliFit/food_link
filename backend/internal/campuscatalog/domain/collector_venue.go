package domain

import "strings"

// CollectorPlaceKey is shared by application deduplication and scope matching.
func CollectorPlaceKey(name string) string {
	value := strings.ToLower(strings.TrimSpace(name))
	if value == "北京ai原点社区" || value == "ai原点社区" {
		return "ai原点社区"
	}
	return value
}

func CollectorPlaceName(name string) string {
	if CollectorPlaceKey(name) == "ai原点社区" {
		return "AI原点社区"
	}
	return strings.TrimSpace(name)
}
