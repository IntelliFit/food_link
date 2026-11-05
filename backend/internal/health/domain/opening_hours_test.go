package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The texts below are real opening_hours_raw values from school_canteens (2026-11-04).
func TestParseOpeningHoursReadsCollectedTexts(t *testing.T) {
	h := func(hour, minute int) int { return hour*60 + minute }
	cases := map[string][]OpeningWindow{
		"早6:30-10:30|午10:30-13:00|晚16:30-19:00|夜宵19:00-22:00": {
			{Meal: "breakfast", Start: h(6, 30), End: h(10, 30)}, {Meal: "lunch", Start: h(10, 30), End: h(13, 0)},
			{Meal: "dinner", Start: h(16, 30), End: h(19, 0)}, {Meal: "evening_snack", Start: h(19, 0), End: h(22, 0)},
		},
		"早餐 06：30-10：00 中餐 10：45-12：45 晚餐 16：30-18：30": {
			{Meal: "breakfast", Start: h(6, 30), End: h(10, 0)}, {Meal: "lunch", Start: h(10, 45), End: h(12, 45)}, {Meal: "dinner", Start: h(16, 30), End: h(18, 30)},
		},
		"早餐7:00--8:30，午餐11:00--13:00，晚餐16:30--18:00": {
			{Meal: "breakfast", Start: h(7, 0), End: h(8, 30)}, {Meal: "lunch", Start: h(11, 0), End: h(13, 0)}, {Meal: "dinner", Start: h(16, 30), End: h(18, 0)},
		},
		"星期一至星期五中午11:00-13:00；下午17:00-19:00": {
			{Meal: "lunch", Start: h(11, 0), End: h(13, 0)}, {Meal: "dinner", Start: h(17, 0), End: h(19, 0)},
		},
		"10:00-19:00": {{Start: h(10, 0), End: h(19, 0)}},
		// The hotpot stall's own hours do not keep the canteen open until 22:00.
		"中餐11:00-13:30（小火锅：11:00-22:00）晚餐16:30-19:30": {
			{Meal: "lunch", Start: h(11, 0), End: h(13, 30)}, {Meal: "dinner", Start: h(16, 30), End: h(19, 30)},
		},
		"早餐6:30-9:30；中餐10:30-13:00；晚餐16:30-19:30（结束时间可按实际延长）": {
			{Meal: "breakfast", Start: h(6, 30), End: h(9, 30)}, {Meal: "lunch", Start: h(10, 30), End: h(13, 0)}, {Meal: "dinner", Start: h(16, 30), End: h(19, 30)},
		},
		"夜宵22:00-次日02:00": {{Meal: "evening_snack", Start: h(22, 0), End: h(26, 0)}},
	}
	for raw, want := range cases {
		assert.Equal(t, want, ParseOpeningHours(raw), raw)
	}
}

func TestParseOpeningHoursIgnoresUntrustedOrTimelessTexts(t *testing.T) {
	for _, raw := range []string{
		"", "三餐开饭期间", "供应早餐、午餐、晚餐", "具体营业时间未列", "餐饮服务电话24小时",
		"寒假服务指南：早餐6:30-9:00，午餐10:30-13:30，晚餐16:30-19:00（假期供餐食堂）",
		"6:30-8:30、10:45-12:45、16:00-18:30（2026寒假值守时段）",
		"2025暑假：早餐6:50-9:00；午餐10:50-13:00；晚餐16:50-19:00。",
		"夜宵19:00-22:00（旧学生手册记录，当前待复核）",
	} {
		assert.Empty(t, ParseOpeningHours(raw), raw)
	}
}

func TestNormalizeMealPeriodsUnderstandsChineseLabels(t *testing.T) {
	assert.Equal(t, []string{"lunch", "dinner"}, NormalizeMealPeriods([]string{"晚餐", "午餐", "lunch"}))
	assert.Equal(t, []string{"breakfast"}, NormalizeMealPeriods([]string{"早餐"}))
	assert.Equal(t, []string{"dinner", "evening_snack"}, NormalizeMealPeriods([]string{"night_snack", "late_night", "夜宵", "dinner"}))
	assert.Equal(t, []string{}, NormalizeMealPeriods([]string{"unknown"}))
	assert.Equal(t, []string{}, NormalizeMealPeriods(nil))
}
