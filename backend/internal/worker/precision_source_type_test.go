package worker

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrecisionPlanSourceType(t *testing.T) {
	cases := []struct {
		name               string
		submitted, session string
		hasImages          bool
		want               string
	}{
		{"文字会话续答被旧确认页标成图片", "image", "text", false, "text"},
		{"文字会话续答", "text", "text", false, "text"},
		{"文字会话补拍了照片", "image", "text", true, "image"},
		{"图片会话", "image", "image", true, "image"},
		{"图片会话只回答问题", "image", "image", false, "image"},
		{"缺少提交类型时沿用会话", "", "text", false, "text"},
		{"未知类型按图片", "video", "", false, "image"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, precisionPlanSourceType(tc.submitted, tc.session, tc.hasImages))
		})
	}
}
