package service

import (
	"bytes"
	"net/http"
	"regexp"
	"strings"
)

// MaxImageBytes caps one original research photo.
const MaxImageBytes = 15 * 1024 * 1024

var objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9/_.-]+$`)

// researchKeyPrefix is where one user's research uploads live; submitted keys
// must sit under it, so nobody can reuse another user's or an analyze photo.
func researchKeyPrefix(userID string) string { return "research-weight/" + userID + "/" }

func validResearchKey(userID, key string) bool {
	return strings.HasPrefix(key, researchKeyPrefix(userID)) && objectKeyPattern.MatchString(key) && !strings.Contains(key, "..")
}

// sniffImage returns the file extension for a JPEG, PNG, WebP or HEIC body,
// or "" when the bytes are not one of those images.
func sniffImage(data []byte) (string, string) {
	switch http.DetectContentType(data) {
	case "image/jpeg":
		return ".jpg", "image/jpeg"
	case "image/png":
		return ".png", "image/png"
	case "image/webp":
		return ".webp", "image/webp"
	}
	if isoBrand(data, "heic", "heix", "mif1", "msf1") {
		return ".heic", "image/heic"
	}
	return "", ""
}

// isVideoContainer accepts MP4/MOV/M4V (ISO base media) bodies only.
func isVideoContainer(data []byte) bool {
	return len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")) && !isoBrand(data, "heic", "heix", "mif1", "msf1")
}

func isoBrand(data []byte, brands ...string) bool {
	if len(data) < 12 || !bytes.Equal(data[4:8], []byte("ftyp")) {
		return false
	}
	major := string(data[8:12])
	for _, brand := range brands {
		if major == brand {
			return true
		}
	}
	return false
}
