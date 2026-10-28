package main

import (
	"fmt"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
)

// minSample is the smallest count a check is judged on; below it the
// verdict is "样本不足" rather than a pass or fail on noise.
const minSample = 30

type rates struct {
	Coverage               float64  `json:"coverage"`
	CanteenAnswerRate      float64  `json:"canteen_answer_rate"`
	DishAnswerRate         float64  `json:"dish_answer_rate"`
	LinkRate               float64  `json:"link_rate"`
	CanteenTop1Rate        float64  `json:"canteen_top1_rate"`
	CanteenTop3Rate        float64  `json:"canteen_top3_rate"`
	LocatedCanteenTop1Rate float64  `json:"located_canteen_top1_rate"`
	ItemTop1Rate           float64  `json:"item_top1_rate"`
	ItemTop4Rate           float64  `json:"item_top4_rate"`
	RecognitionTop1Rate    float64  `json:"recognition_top1_rate"`
	RecognitionTop3Rate    float64  `json:"recognition_top3_rate"`
	PhotoConsentRate       float64  `json:"photo_consent_rate"`
	RepeatLinkingRate      float64  `json:"repeat_linking_rate"`
	RecordRateAll          float64  `json:"record_rate_all"`
	RecordRatePrompted     float64  `json:"record_rate_prompted"`
	RecordRateUnprompted   float64  `json:"record_rate_unprompted"`
	RecordRateBaseline     *float64 `json:"record_rate_baseline,omitempty"`
	RecommendedHitRate     float64  `json:"recommended_hit_rate"`
	RecommendedStrongRate  float64  `json:"recommended_strong_hit_rate"`
	PriceAnswerRate        float64  `json:"price_answer_rate"`
	AskedMoreRecordRate    float64  `json:"active_cohorts_record_rate"`
}

type check struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Target  string `json:"target"`
	Sample  int64  `json:"sample"`
	Verdict string `json:"verdict"`
}

func ratio(part, whole int64) float64 {
	if whole <= 0 {
		return 0
	}
	return float64(part) / float64(whole)
}

func pct(value float64) string {
	return fmt.Sprintf("%.1f%%", value*100)
}

func computeRates(f *repo.Funnel, prior *repo.TaskStats) rates {
	r := rates{
		Coverage:               ratio(f.Prompts, f.PhotoTasks),
		CanteenAnswerRate:      ratio(f.CanteenAnswered, f.Prompts),
		DishAnswerRate:         ratio(f.DishAnswered, f.CanteenAnswered),
		LinkRate:               ratio(f.DishAnswered, f.Prompts),
		CanteenTop1Rate:        ratio(f.CanteenTop1, f.CanteenAnswered),
		CanteenTop3Rate:        ratio(f.CanteenTop3, f.CanteenAnswered),
		LocatedCanteenTop1Rate: ratio(f.LocatedCanteenTop1, f.LocatedAnswered),
		ItemTop1Rate:           ratio(f.ItemTop1, f.DishAnswered),
		ItemTop4Rate:           ratio(f.ItemTop4, f.DishAnswered),
		RecognitionTop1Rate:    ratio(f.RecognitionTop1, f.RecognitionRanked),
		RecognitionTop3Rate:    ratio(f.RecognitionTop3, f.RecognitionRanked),
		PhotoConsentRate:       ratio(f.PhotoConsented, f.PhotoAsked),
		RepeatLinkingRate:      ratio(f.RepeatLinkingUsers, f.LinkingUsers),
		RecordRateAll:          ratio(f.RecordedTasks, f.DoneTasks),
		RecordRatePrompted:     ratio(f.PromptedRecordedTasks, f.PromptedDoneTasks),
		RecordRateUnprompted:   ratio(f.RecordedTasks-f.PromptedRecordedTasks, f.DoneTasks-f.PromptedDoneTasks),
	}
	if prior != nil {
		value := ratio(prior.RecordedTasks, prior.DoneTasks)
		r.RecordRateBaseline = &value
	}
	r.RecommendedHitRate = ratio(f.RecommendedHit, f.RecommendedAnswered)
	r.RecommendedStrongRate = ratio(f.RecommendedStrongHit, f.RecommendedStrong)
	r.PriceAnswerRate = ratio(f.PriceSame+f.PriceChanged, f.PriceAsked)
	done, recorded := askedMoreTasks(f)
	r.AskedMoreRecordRate = ratio(recorded, done)
	return r
}

// askedMoreTasks sums the cohorts that may get the extra price question.
func askedMoreTasks(f *repo.Funnel) (done, recorded int64) {
	for _, cohort := range f.Cohorts {
		if cohort.Cohort == domain.CohortActive || cohort.Cohort == domain.CohortContributor {
			done += cohort.PromptedDoneTasks
			recorded += cohort.PromptedRecordedTasks
		}
	}
	return done, recorded
}

// evaluate turns the numbers into the go/no-go calls. The targets are first
// guesses for the trial and should be tightened once real numbers arrive.
func evaluate(f *repo.Funnel, r rates) []check {
	atLeast := func(name string, value float64, target float64, sample int64) check {
		c := check{Name: name, Value: pct(value), Target: "≥ " + pct(target), Sample: sample}
		c.Verdict = verdict(sample, value >= target)
		return c
	}
	checks := []check{
		atLeast("提示覆盖（拍照任务里出现提示的比例）", r.Coverage, 0.25, f.PhotoTasks),
		atLeast("端到端关联率（出现提示后选到菜）", r.LinkRate, 0.35, f.Prompts),
		atLeast("食堂推荐第 1 个就对", r.CanteenTop1Rate, 0.70, f.CanteenAnswered),
		atLeast("实拍图同意率", r.PhotoConsentRate, 0.30, f.PhotoAsked),
	}
	auto := atLeast("识别结果排第 1 就对（可开自动关联的门槛）", r.RecognitionTop1Rate, 0.85, f.RecognitionRanked)
	if auto.Verdict == "未达标" {
		auto.Verdict = "继续手选"
	} else if auto.Verdict == "达标" {
		auto.Verdict = "可试自动关联"
	}
	checks = append(checks, auto,
		atLeast("首页推荐一键确认命中（选的就是推荐那道）", r.RecommendedHitRate, 0.60, f.RecommendedAnswered),
		atLeast("价格追问回答率（积极用户）", r.PriceAnswerRate, 0.50, f.PriceAsked))

	// 护栏：出现提示的任务记录完成率不比没出现的低 3 个百分点以上；有上线前基线时也对比基线。
	compare, against := r.RecordRateUnprompted, "未出现提示的任务"
	if r.RecordRateBaseline != nil {
		compare, against = *r.RecordRateBaseline, "上线前基线"
	}
	guard := check{Name: "记录完成率不下降（对比" + against + "）", Value: pct(r.RecordRatePrompted),
		Target: "≥ " + pct(compare-0.03), Sample: f.PromptedDoneTasks}
	guard.Verdict = verdict(f.PromptedDoneTasks, r.RecordRatePrompted >= compare-0.03)
	if guard.Verdict == "未达标" {
		guard.Verdict = "停：伤到主流程"
	}
	// 多问一句的积极用户单独看：他们的记录完成率也不能掉。
	askedDone, _ := askedMoreTasks(f)
	askedGuard := check{Name: "积极用户记录完成率不下降（对比" + against + "）", Value: pct(r.AskedMoreRecordRate),
		Target: "≥ " + pct(compare-0.03), Sample: askedDone}
	askedGuard.Verdict = verdict(askedDone, r.AskedMoreRecordRate >= compare-0.03)
	if askedGuard.Verdict == "未达标" {
		askedGuard.Verdict = "停：关掉价格追问"
	}
	return append(checks, guard, askedGuard)
}

func verdict(sample int64, ok bool) string {
	switch {
	case sample < minSample:
		return "样本不足"
	case ok:
		return "达标"
	default:
		return "未达标"
	}
}
