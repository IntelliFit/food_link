// Command meal-dish-report answers "is the canteen/dish prompt working?" for
// a time window. It runs read-only queries in a READ ONLY transaction and
// never writes business data.
//
//	go run ./cmd/meal-dish-report -config-dir . -days 7
//	go run ./cmd/meal-dish-report -config-dir . -since 2026-10-25 -until 2026-11-01 \
//	    -baseline-since 2026-10-18 -baseline-until 2026-10-25 -json
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

var shanghai = time.FixedZone("Asia/Shanghai", 8*3600)

type report struct {
	Since    string       `json:"since"`
	Until    string       `json:"until"`
	Funnel   *repo.Funnel `json:"funnel"`
	Baseline *baseline    `json:"baseline,omitempty"`
	Rates    rates        `json:"rates"`
	Checks   []check      `json:"checks"`
}

type baseline struct {
	Since string         `json:"since"`
	Until string         `json:"until"`
	Tasks repo.TaskStats `json:"tasks"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	days := flag.Int("days", 7, "window length ending now, when -since is empty")
	sinceText := flag.String("since", "", "window start date YYYY-MM-DD (Asia/Shanghai)")
	untilText := flag.String("until", "", "window end date YYYY-MM-DD, exclusive; empty = now")
	baselineSince := flag.String("baseline-since", "", "pre-launch window start, for the record-rate guardrail")
	baselineUntil := flag.String("baseline-until", "", "pre-launch window end, exclusive")
	asJSON := flag.Bool("json", false, "print the full report as JSON")
	flag.Parse()

	until := time.Now().In(shanghai)
	if *untilText != "" {
		until = mustDate(*untilText)
	}
	since := until.AddDate(0, 0, -*days)
	if *sinceText != "" {
		since = mustDate(*sinceText)
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	out := report{Since: since.Format(time.RFC3339), Until: until.Format(time.RFC3339)}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET TRANSACTION READ ONLY").Error; err != nil {
			return err
		}
		if err := tx.Exec("SET LOCAL statement_timeout = '90s'").Error; err != nil {
			return err
		}
		reader := repo.New(tx)
		funnel, err := reader.Funnel(ctx, since, until)
		if err != nil {
			return err
		}
		out.Funnel = funnel
		if *baselineSince != "" && *baselineUntil != "" {
			bSince, bUntil := mustDate(*baselineSince), mustDate(*baselineUntil)
			prior, err := reader.Funnel(ctx, bSince, bUntil)
			if err != nil {
				return err
			}
			out.Baseline = &baseline{Since: bSince.Format(time.RFC3339), Until: bUntil.Format(time.RFC3339), Tasks: prior.TaskStats}
		}
		return nil
	})
	if err != nil {
		log.Fatalf("读取统计失败: %v", err)
	}
	var prior *repo.TaskStats
	if out.Baseline != nil {
		prior = &out.Baseline.Tasks
	}
	out.Rates = computeRates(out.Funnel, prior)
	out.Checks = evaluate(out.Funnel, out.Rates)
	if *asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(out); err != nil {
			log.Fatal(err)
		}
		return
	}
	printSummary(out)
}

func cohortLabel(cohort string) string {
	switch cohort {
	case "active":
		return "积极用户"
	case "contributor":
		return "贡献者"
	default:
		return "普通用户"
	}
}

func mustDate(value string) time.Time {
	parsed, err := time.ParseInLocation("2006-01-02", value, shanghai)
	if err != nil {
		log.Fatalf("日期格式应为 YYYY-MM-DD: %q", value)
	}
	return parsed
}

func printSummary(out report) {
	f, r := out.Funnel, out.Rates
	fmt.Printf("窗口 %s ~ %s\n\n", out.Since[:10], out.Until[:10])
	fmt.Println("一、流程走通了吗（漏斗）")
	fmt.Printf("  拍照识别任务 %d（%d 人）→ 出现提示 %d（%d 人，覆盖 %s；等待页 %d / 结果页 %d）\n",
		f.PhotoTasks, f.PhotoTaskUsers, f.Prompts, f.PromptUsers, pct(r.Coverage), f.WaitPrompts, f.ResultPrompts)
	fmt.Printf("  → 选了食堂 %d（%s）→ 选了菜 %d（%s，端到端 %s）\n",
		f.CanteenAnswered, pct(r.CanteenAnswerRate), f.DishAnswered, pct(r.DishAnswerRate), pct(r.LinkRate))
	fmt.Printf("  跳过：食堂这步 %d，菜这步 %d（其中菜单上没有 %d），照片这步 %d\n",
		f.SkippedAtCanteen, f.SkippedAtDish, f.MenuGaps, f.SkippedAtPhoto)
	fmt.Printf("  中位用时：出现→选食堂 %.0f 秒，选食堂→选菜 %.0f 秒\n\n", f.MedianCanteenSec, f.MedianDishSec)

	fmt.Println("二、推荐准不准（决定能不能自动关联）")
	fmt.Printf("  食堂：第 1 个就对 %s，前 3 个内 %s；有定位时第 1 个就对 %s\n",
		pct(r.CanteenTop1Rate), pct(r.CanteenTop3Rate), pct(r.LocatedCanteenTop1Rate))
	fmt.Printf("  菜品：排第 1 %s，前 4 %s；只看识别结果排第 1 %s、前 3 %s（样本 %d）\n\n",
		pct(r.ItemTop1Rate), pct(r.ItemTop4Rate), pct(r.RecognitionTop1Rate), pct(r.RecognitionTop3Rate), f.RecognitionRanked)

	fmt.Printf("  首页推荐一键确认：带着推荐打开 %d 次，选到菜 %d 次，选的就是推荐那道 %d（%s）；导航过/问过的 %s\n\n",
		f.Recommended, f.RecommendedAnswered, f.RecommendedHit, pct(r.RecommendedHitRate), pct(r.RecommendedStrongRate))

	fmt.Println("三、有没有伤主流程（护栏）")
	fmt.Printf("  记录完成率：出现提示的任务 %s，未出现的 %s", pct(r.RecordRatePrompted), pct(r.RecordRateUnprompted))
	if r.RecordRateBaseline != nil {
		fmt.Printf("，上线前基线 %s", pct(*r.RecordRateBaseline))
	}
	fmt.Printf("（整体 %s）\n", pct(r.RecordRateAll))
	for _, cohort := range f.Cohorts {
		fmt.Printf("  %s：提示 %d，选到菜 %d，记录完成率 %s\n", cohortLabel(cohort.Cohort), cohort.Prompts, cohort.DishAnswered,
			pct(ratio(cohort.PromptedRecordedTasks, cohort.PromptedDoneTasks)))
	}
	fmt.Println()

	fmt.Println("四、数据飞轮转起来没有")
	fmt.Printf("  关联到 %d 个食堂、%d 道菜；%d 道菜新增了实拍图（同意率 %s，发放积分 %d）\n",
		f.LinkedCanteens, f.LinkedDishes, f.PhotoDishes, pct(r.PhotoConsentRate), f.RewardCredits)
	fmt.Printf("  %d 人关联过菜品，其中 %d 人关联 ≥2 次（%s）；累计学到坐标的食堂 %d 个（有样本 %d 个）\n",
		f.LinkingUsers, f.RepeatLinkingUsers, pct(r.RepeatLinkingRate), f.LearnedCanteens, f.CanteensWithSamples)
	fmt.Printf("  价格追问 %d 次：还是原价 %d，填了新价 %d，跳过 %d（回答率 %s）；两人一致写回 %d 道\n",
		f.PriceAsked, f.PriceSame, f.PriceChanged, f.PriceSkipped, pct(r.PriceAnswerRate), f.PriceApplied)
	if len(f.MenuGapCanteens) > 0 {
		fmt.Println("  菜单缺口最多的食堂（下一轮采集优先去）：")
		for _, gap := range f.MenuGapCanteens {
			fmt.Printf("    %s  缺 %d / 回答 %d\n", gap.CanteenName, gap.Gaps, gap.Answered)
		}
	}
	fmt.Println("\n判断")
	for _, c := range out.Checks {
		fmt.Printf("  [%s] %s：%s（目标 %s，样本 %d）\n", c.Verdict, c.Name, c.Value, c.Target, c.Sample)
	}
}
