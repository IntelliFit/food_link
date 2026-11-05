package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Replay 2026-11-05: "这家现在还开着吗" went through the whole meal Agent and failed.
func TestOpeningHoursQuestionIsAnsweredFromTheCard(t *testing.T) {
	for _, q := range []string{"这家现在还开着吗", "几点关门", "还在营业吗", "现在还能去吗", "关门了吗"} {
		assert.True(t, mealHoursQuestion(q), q)
	}
	for _, q := range []string{"关门了的话推荐别的", "推荐点吃的", "换家店", "开着的食堂有哪些推荐一下"} {
		assert.False(t, mealHoursQuestion(q), q)
	}
	options := []DietRecommendationOption{
		{Title: "金汤小米煮三鲜", IsCampusFood: true, SchoolName: "北京大学", CanteenName: "勺园食堂", OpeningHours: "早6:30-10:30|午10:30-13:00|晚16:30-19:00|夜宵19:00-22:00"},
		{Title: "番茄炒蛋", IsCampusFood: true, SchoolName: "清华大学", CanteenName: "桃李园"},
		{Title: "青菜瘦肉粥", MerchantName: "曼玲粥店(六道口店·焖面)"},
		{Title: "皮蛋鸡肉粥", MerchantName: "曼玲粥店(六道口店·焖面)"},
	}
	night := mealHoursAnswer(23*60+49, options)
	assert.Contains(t, night, "北京大学勺园食堂按收录的营业时间（早6:30–10:30、午10:30–13:00、晚16:30–19:00、夜宵19:00–22:00），现在不在供餐时间")
	assert.Contains(t, night, "清华大学桃李园没有收录营业时间，按一般食堂饭点")
	assert.Contains(t, night, "曼玲粥店(六道口店·焖面)没有收录营业时间")
	assert.Equal(t, 1, countSubstring(night, "曼玲粥店"), "one line per venue")
	assert.Contains(t, night, "想换成现在开着的")
	noon := mealHoursAnswer(12*60, options[:1])
	assert.Contains(t, noon, "现在在供餐时间内")
	assert.NotContains(t, noon, "想换成")
}
