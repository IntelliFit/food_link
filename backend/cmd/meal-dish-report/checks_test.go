package main

import (
	"testing"

	"food_link/backend/internal/mealdish/repo"

	"github.com/stretchr/testify/require"
)

func TestChecksJudgeOnlyWithEnoughSamples(t *testing.T) {
	f := &repo.Funnel{
		PromptStats: repo.PromptStats{Prompts: 100, CanteenAnswered: 60, CanteenTop1: 48, DishAnswered: 40,
			RecognitionRanked: 40, RecognitionTop1: 36, PhotoAsked: 10, PhotoConsented: 5},
		TaskStats: repo.TaskStats{PhotoTasks: 300, DoneTasks: 280, RecordedTasks: 140, PromptedDoneTasks: 90, PromptedRecordedTasks: 40},
	}
	r := computeRates(f, nil)
	require.InDelta(t, 1.0/3, r.Coverage, 1e-9)
	require.InDelta(t, 0.4, r.LinkRate, 1e-9)
	require.InDelta(t, 100.0/190, r.RecordRateUnprompted, 1e-9)

	byName := map[string]check{}
	for _, c := range evaluate(f, r) {
		byName[c.Name] = c
	}
	require.Equal(t, "达标", byName["提示覆盖（拍照任务里出现提示的比例）"].Verdict)
	require.Equal(t, "达标", byName["食堂推荐第 1 个就对"].Verdict)
	require.Equal(t, "样本不足", byName["实拍图同意率"].Verdict, "10 photo asks are too few to judge")
	require.Equal(t, "可试自动关联", byName["识别结果排第 1 就对（可开自动关联的门槛）"].Verdict)
	require.Equal(t, "停：伤到主流程", byName["记录完成率不下降（对比未出现提示的任务）"].Verdict,
		"44% recorded with the prompt vs 53% without is a stop signal")

	base := 0.46
	withBaseline := computeRates(f, &repo.TaskStats{DoneTasks: 100, RecordedTasks: 46})
	require.InDelta(t, base, *withBaseline.RecordRateBaseline, 1e-9)
	for _, c := range evaluate(f, withBaseline) {
		if c.Name == "记录完成率不下降（对比上线前基线）" {
			require.Equal(t, "达标", c.Verdict, "44.4% is within 3 points of the 46% baseline")
		}
	}
}

func TestChecksForRecommendationAndPriceQuestion(t *testing.T) {
	f := &repo.Funnel{
		PromptStats: repo.PromptStats{RecommendedAnswered: 40, RecommendedHit: 30, RecommendedStrong: 10, RecommendedStrongHit: 9,
			PriceAsked: 40, PriceSame: 12, PriceChanged: 4, PriceSkipped: 20},
		TaskStats: repo.TaskStats{DoneTasks: 200, RecordedTasks: 150, PromptedDoneTasks: 80, PromptedRecordedTasks: 60},
		Cohorts: []repo.CohortStats{
			{Cohort: "regular", PromptedDoneTasks: 40, PromptedRecordedTasks: 32},
			{Cohort: "active", PromptedDoneTasks: 30, PromptedRecordedTasks: 18},
			{Cohort: "contributor", PromptedDoneTasks: 10, PromptedRecordedTasks: 10},
		},
	}
	r := computeRates(f, nil)
	require.InDelta(t, 0.75, r.RecommendedHitRate, 1e-9)
	require.InDelta(t, 0.9, r.RecommendedStrongRate, 1e-9)
	require.InDelta(t, 0.4, r.PriceAnswerRate, 1e-9)
	require.InDelta(t, 28.0/40, r.AskedMoreRecordRate, 1e-9, "active and contributor cohorts together")

	byName := map[string]check{}
	for _, c := range evaluate(f, r) {
		byName[c.Name] = c
	}
	require.Equal(t, "达标", byName["首页推荐一键确认命中（选的就是推荐那道）"].Verdict)
	require.Equal(t, "未达标", byName["价格追问回答率（积极用户）"].Verdict)
	require.Equal(t, "停：关掉价格追问", byName["积极用户记录完成率不下降（对比未出现提示的任务）"].Verdict,
		"70% for asked-more users vs 75% without the prompt is more than 3 points down")
}
