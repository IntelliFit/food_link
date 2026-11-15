package repo

import (
	"reflect"
	"testing"
)

func TestPackagedPrimaryImagePreservesGallery(t *testing.T) {
	input := []string{"", " https://example.com/front.jpg ", "https://example.com/panel.jpg", "https://example.com/net-weight.jpg", "https://example.com/front.jpg", "  "}
	cover, images := packagedPrimaryImage(input)
	want := []string{"https://example.com/front.jpg", "https://example.com/panel.jpg", "https://example.com/net-weight.jpg"}
	if cover == nil || *cover != want[0] || !reflect.DeepEqual(images, want) {
		t.Fatalf("packaging evidence lost or reordered: cover=%v images=%v", cover, images)
	}
	if input[1] != " https://example.com/front.jpg " {
		t.Fatal("source image references were modified")
	}
}

func TestPackagedPrimaryImageWithoutPhotos(t *testing.T) {
	cover, images := packagedPrimaryImage([]string{"", "  "})
	if cover != nil || images != nil {
		t.Fatalf("expected no cover or gallery, got cover=%v images=%v", cover, images)
	}
}
