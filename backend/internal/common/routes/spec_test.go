package routes

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSpec_GinPath(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		want   string
	}{
		{
			name: "no params",
			path: "/api/user/profile",
			want: "/api/user/profile",
		},
		{
			name: "single param",
			path: "/api/food-record/{record_id}",
			want: "/api/food-record/:record_id",
		},
		{
			name: "multiple params",
			path: "/api/community/feed/{record_id}/comments/{comment_id}",
			want: "/api/community/feed/:record_id/comments/:comment_id",
		},
		{
			name: "empty path",
			path: "",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := Spec{Path: tt.path}
			assert.Equal(t, tt.want, s.GinPath())
		})
	}
}
