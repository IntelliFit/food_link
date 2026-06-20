package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNameSimilarity_CommonPrefixAndFoodCategory(t *testing.T) {
	cases := []struct {
		a, b     string
		expected float64
	}{
		{"统一橙汁饮料", "统一鲜橙多橙汁饮料", 0.85},
		{"德芙巧克力", "德芙牛奶巧克力", 0.85},
		{"可口可乐", "可口可乐零度", 0.9},
		{"苹果", "香蕉", 0},
		{"红烧肉", "红烧排骨", 0.4},
	}
	for _, tc := range cases {
		got := nameSimilarity(tc.a, tc.b)
		assert.InDelta(t, tc.expected, got, 1e-6, "nameSimilarity(%q,%q)", tc.a, tc.b)
	}
}

func TestExtractItems_FromMapSlice(t *testing.T) {
	data := map[string]any{
		"items": []map[string]any{
			{"name": "统一鲜橙多橙汁饮料", "estimatedWeightGrams": 150},
			{"name": "面包", "grossWeightGrams": 80},
		},
	}
	items := extractItems(data)
	assert.Len(t, items, 2)
	assert.Equal(t, "统一鲜橙多橙汁饮料", items[0].Name)
	assert.InDelta(t, 150, items[0].Weight, 1e-6)
	assert.Equal(t, "面包", items[1].Name)
	assert.InDelta(t, 80, items[1].Weight, 1e-6)
}
