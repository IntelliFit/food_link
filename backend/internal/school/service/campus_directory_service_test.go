package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExtractCanteenFloors(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "multiple floors", raw: "一楼、二楼", want: []string{"一楼", "二楼"}},
		{name: "floor range", raw: "一至三楼", want: []string{"一楼", "二楼", "三楼"}},
		{name: "basement floor range", raw: "负三至负一楼", want: []string{"负三楼", "负二楼", "负一楼"}},
		{name: "range across ground skips floor zero", raw: "负一至二楼", want: []string{"负一楼", "一楼", "二楼"}},
		{name: "basement wording", raw: "国内大厦负一层", want: []string{"负一楼"}},
		{name: "basement code", raw: "B2 美食广场", want: []string{"负二楼"}},
		{name: "descriptive text", raw: "一楼；二楼大众特色餐厅", want: []string{"一楼", "二楼"}},
		{name: "total floor count is not a floor", raw: "食堂共五层", want: nil},
		{name: "total count keeps explicit basement", raw: "共五层（含地下一层）", want: []string{"负一楼"}},
		{name: "no floor", raw: "校区东门附近", want: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, extractCanteenFloors(tt.raw))
		})
	}
}

func TestFallbackCanteenFloors(t *testing.T) {
	rows := fallbackCanteenFloors()

	assert.Equal(t, []string{
		"负一楼", "一楼", "二楼", "三楼", "四楼", "五楼", "平层", "其他楼层",
	}, []string{
		rows[0].Name, rows[1].Name, rows[2].Name, rows[3].Name,
		rows[4].Name, rows[5].Name, rows[6].Name, rows[7].Name,
	})
	for _, row := range rows {
		assert.True(t, row.IsFallback)
		assert.Equal(t, row.Name == "一楼", row.IsDefault)
	}
}
