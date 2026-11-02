package repo

import (
	"context"
	"time"
)

// Funnel is what the meal-dish prompt did in a time window: how often it
// was shown, how far users answered, how good the suggestions were, whether
// it cost the normal record flow, and what data it brought back.
type Funnel struct {
	PromptStats
	TaskStats
	SampleStats
	MenuGapCanteens []MenuGapCanteen `json:"menu_gap_canteens"`
	Cohorts         []CohortStats    `json:"cohorts"`
}

// CohortStats splits the prompts by how much the user may be asked, with
// each cohort's own record completion as its guardrail.
type CohortStats struct {
	Cohort                string `json:"cohort"`
	Prompts               int64  `json:"prompts"`
	DishAnswered          int64  `json:"dish_answered"`
	PriceAsked            int64  `json:"price_asked"`
	PriceAnswered         int64  `json:"price_answered"`
	PromptedDoneTasks     int64  `json:"prompted_done_tasks"`
	PromptedRecordedTasks int64  `json:"prompted_recorded_tasks"`
}

// PromptStats counts prompt rows created in the window.
type PromptStats struct {
	Prompts            int64   `json:"prompts"`
	PromptUsers        int64   `json:"prompt_users"`
	WaitPrompts        int64   `json:"wait_prompts"`
	ResultPrompts      int64   `json:"result_prompts"`
	Located            int64   `json:"located"`
	WithSuggestions    int64   `json:"with_suggestions"`
	CanteenAnswered    int64   `json:"canteen_answered"`
	CanteenTop1        int64   `json:"canteen_top1"`
	CanteenTop3        int64   `json:"canteen_top3"`
	LocatedAnswered    int64   `json:"located_canteen_answered"`
	LocatedCanteenTop1 int64   `json:"located_canteen_top1"`
	DishAnswered       int64   `json:"dish_answered"`
	ItemTop1           int64   `json:"item_top1"`
	ItemTop4           int64   `json:"item_top4"`
	RecognitionRanked  int64   `json:"recognition_ranked"`
	RecognitionTop1    int64   `json:"recognition_top1"`
	RecognitionTop3    int64   `json:"recognition_top3"`
	SkippedAtCanteen   int64   `json:"skipped_at_canteen"`
	SkippedAtDish      int64   `json:"skipped_at_dish"`
	SkippedAtPhoto     int64   `json:"skipped_at_photo"`
	MenuGaps           int64   `json:"menu_gaps"`
	PhotoAsked         int64   `json:"photo_asked"`
	PhotoConsented     int64   `json:"photo_consented"`
	PhotoContributed   int64   `json:"photo_contributed"`
	RewardCredits      int64   `json:"reward_credits"`
	MedianCanteenSec   float64 `json:"median_seconds_to_canteen"`
	MedianDishSec      float64 `json:"median_seconds_canteen_to_dish"`
	LinkedCanteens     int64   `json:"linked_canteens"`
	LinkedDishes       int64   `json:"linked_dishes"`
	PhotoDishes        int64   `json:"dishes_given_photos"`
	LinkingUsers       int64   `json:"linking_users"`
	RepeatLinkingUsers int64   `json:"repeat_linking_users"`

	// Recommended prompts started from a home recommendation; a hit is when
	// the user confirmed that dish. Strong ones were navigated to or asked about.
	Recommended          int64 `json:"recommended"`
	RecommendedAnswered  int64 `json:"recommended_dish_answered"`
	RecommendedHit       int64 `json:"recommended_hit"`
	RecommendedStrong    int64 `json:"recommended_strong"`
	RecommendedStrongHit int64 `json:"recommended_strong_hit"`
	PriceAsked           int64 `json:"price_asked"`
	PriceSame            int64 `json:"price_same"`
	PriceChanged         int64 `json:"price_changed"`
	PriceSkipped         int64 `json:"price_skipped"`
	PriceApplied         int64 `json:"price_applied"`
}

// TaskStats compares the record completion of prompted and unprompted photo
// tasks: the guardrail that the prompt does not cost records.
type TaskStats struct {
	PhotoTasks            int64 `json:"photo_tasks"`
	PhotoTaskUsers        int64 `json:"photo_task_users"`
	DoneTasks             int64 `json:"done_photo_tasks"`
	RecordedTasks         int64 `json:"recorded_photo_tasks"`
	PromptedDoneTasks     int64 `json:"prompted_done_tasks"`
	PromptedRecordedTasks int64 `json:"prompted_recorded_tasks"`
}

// SampleStats is the all-time geo data the prompt has learned.
type SampleStats struct {
	LearnedCanteens     int64 `json:"learned_canteens_total"`
	CanteensWithSamples int64 `json:"canteens_with_samples_total"`
}

// MenuGapCanteen is a canteen where users looked for a dish the menu lacks,
// i.e. where the next capture round should go.
type MenuGapCanteen struct {
	CanteenID   string `json:"canteen_id"`
	CanteenName string `json:"canteen_name"`
	Gaps        int64  `json:"gaps"`
	Answered    int64  `json:"answered"`
}

const funnelPromptSQL = `
WITH p AS (
  SELECT * FROM meal_dish_prompts WHERE created_at >= @since AND created_at < @until
)
SELECT
  count(*) AS prompts,
  count(DISTINCT user_id) AS prompt_users,
  count(*) FILTER (WHERE surface = 'wait') AS wait_prompts,
  count(*) FILTER (WHERE surface = 'result') AS result_prompts,
  count(*) FILTER (WHERE location_status = 'granted') AS located,
  count(*) FILTER (WHERE jsonb_array_length(suggested_canteen_ids) > 0) AS with_suggestions,
  count(*) FILTER (WHERE chosen_canteen_id IS NOT NULL) AS canteen_answered,
  count(*) FILTER (WHERE canteen_rank = 0) AS canteen_top1,
  count(*) FILTER (WHERE canteen_rank BETWEEN 0 AND 2) AS canteen_top3,
  count(*) FILTER (WHERE location_status = 'granted' AND chosen_canteen_id IS NOT NULL) AS located_answered,
  count(*) FILTER (WHERE location_status = 'granted' AND canteen_rank = 0) AS located_canteen_top1,
  count(*) FILTER (WHERE chosen_item_id IS NOT NULL) AS dish_answered,
  count(*) FILTER (WHERE item_rank = 0) AS item_top1,
  count(*) FILTER (WHERE item_rank BETWEEN 0 AND 3) AS item_top4,
  count(*) FILTER (WHERE recognition_rank IS NOT NULL) AS recognition_ranked,
  count(*) FILTER (WHERE recognition_rank = 0) AS recognition_top1,
  count(*) FILTER (WHERE recognition_rank BETWEEN 0 AND 2) AS recognition_top3,
  count(*) FILTER (WHERE skipped_at IS NOT NULL AND skip_step = 'canteen') AS skipped_at_canteen,
  count(*) FILTER (WHERE skipped_at IS NOT NULL AND skip_step = 'dish') AS skipped_at_dish,
  count(*) FILTER (WHERE skipped_at IS NOT NULL AND skip_step = 'photo') AS skipped_at_photo,
  count(*) FILTER (WHERE gap_kind = 'menu') AS menu_gaps,
  count(*) FILTER (WHERE gap_kind = 'photo') AS photo_asked,
  count(*) FILTER (WHERE photo_consent IS TRUE) AS photo_consented,
  count(*) FILTER (WHERE photo_contributed_at IS NOT NULL) AS photo_contributed,
  coalesce(sum(reward_credits), 0) AS reward_credits,
  coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM canteen_answered_at - created_at)::float8), 0) AS median_canteen_sec,
  coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM item_answered_at - canteen_answered_at)::float8), 0) AS median_dish_sec,
  count(DISTINCT chosen_canteen_id) AS linked_canteens,
  count(DISTINCT chosen_item_id) AS linked_dishes,
  count(DISTINCT chosen_item_id) FILTER (WHERE photo_contributed_at IS NOT NULL) AS photo_dishes,
  count(DISTINCT user_id) FILTER (WHERE chosen_item_id IS NOT NULL) AS linking_users,
  (SELECT count(*) FROM (SELECT user_id FROM p WHERE chosen_item_id IS NOT NULL GROUP BY user_id HAVING count(*) >= 2) r) AS repeat_linking_users,
  count(*) FILTER (WHERE recommended_item_id IS NOT NULL) AS recommended,
  count(*) FILTER (WHERE recommended_item_id IS NOT NULL AND chosen_item_id IS NOT NULL) AS recommended_answered,
  count(*) FILTER (WHERE recommended_item_id IS NOT NULL AND chosen_item_id = recommended_item_id) AS recommended_hit,
  count(*) FILTER (WHERE recommended_kind IN ('navigated', 'chatted')) AS recommended_strong,
  count(*) FILTER (WHERE recommended_kind IN ('navigated', 'chatted') AND chosen_item_id = recommended_item_id) AS recommended_strong_hit,
  count(*) FILTER (WHERE price_asked_at IS NOT NULL) AS price_asked,
  count(*) FILTER (WHERE price_answer_kind = 'same') AS price_same,
  count(*) FILTER (WHERE price_answer_kind = 'changed') AS price_changed,
  count(*) FILTER (WHERE price_answer_kind = 'skipped') AS price_skipped,
  count(*) FILTER (WHERE price_applied_at IS NOT NULL) AS price_applied
FROM p`

const funnelTaskSQL = `
SELECT
  count(*) AS photo_tasks,
  count(DISTINCT t.user_id) AS photo_task_users,
  count(*) FILTER (WHERE t.status = 'done') AS done_tasks,
  count(*) FILTER (WHERE t.status = 'done' AND EXISTS (SELECT 1 FROM user_food_records r WHERE r.source_task_id = t.id)) AS recorded_tasks,
  count(*) FILTER (WHERE t.status = 'done' AND p.id IS NOT NULL) AS prompted_done_tasks,
  count(*) FILTER (WHERE t.status = 'done' AND p.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM user_food_records r WHERE r.source_task_id = t.id)) AS prompted_recorded_tasks
FROM analysis_tasks t
LEFT JOIN meal_dish_prompts p ON p.analysis_task_id = t.id AND p.user_id = t.user_id
WHERE t.task_type = 'food' AND t.created_at >= @since AND t.created_at < @until`

const funnelSampleSQL = `
SELECT
  count(*) FILTER (WHERE n >= 2) AS learned_canteens,
  count(*) AS canteens_with_samples
FROM (SELECT canteen_id, count(*) AS n FROM canteen_location_samples GROUP BY canteen_id) s`

const funnelMenuGapSQL = `
SELECT chosen_canteen_id AS canteen_id, max(chosen_canteen_name) AS canteen_name,
  count(*) FILTER (WHERE gap_kind = 'menu') AS gaps, count(*) AS answered
FROM meal_dish_prompts
WHERE created_at >= @since AND created_at < @until AND chosen_canteen_id IS NOT NULL
GROUP BY chosen_canteen_id
HAVING count(*) FILTER (WHERE gap_kind = 'menu') > 0
ORDER BY gaps DESC, answered DESC
LIMIT 10`

const funnelCohortSQL = `
SELECT p.cohort, count(*) AS prompts,
  count(*) FILTER (WHERE p.chosen_item_id IS NOT NULL) AS dish_answered,
  count(*) FILTER (WHERE p.price_asked_at IS NOT NULL) AS price_asked,
  count(*) FILTER (WHERE p.price_answer_kind IN ('same', 'changed')) AS price_answered,
  count(*) FILTER (WHERE t.status = 'done') AS prompted_done_tasks,
  count(*) FILTER (WHERE t.status = 'done' AND EXISTS (SELECT 1 FROM user_food_records r WHERE r.source_task_id = t.id)) AS prompted_recorded_tasks
FROM meal_dish_prompts p
LEFT JOIN analysis_tasks t ON t.id = p.analysis_task_id
WHERE p.created_at >= @since AND p.created_at < @until
GROUP BY p.cohort
ORDER BY p.cohort`

// Funnel reads the effectiveness numbers for [since, until). It only reads.
func (r *Repo) Funnel(ctx context.Context, since, until time.Time) (*Funnel, error) {
	args := map[string]any{"since": since, "until": until}
	db := r.db.WithContext(ctx)
	funnel := &Funnel{MenuGapCanteens: []MenuGapCanteen{}, Cohorts: []CohortStats{}}
	if err := db.Raw(funnelPromptSQL, args).Scan(&funnel.PromptStats).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(funnelTaskSQL, args).Scan(&funnel.TaskStats).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(funnelSampleSQL).Scan(&funnel.SampleStats).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(funnelMenuGapSQL, args).Scan(&funnel.MenuGapCanteens).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(funnelCohortSQL, args).Scan(&funnel.Cohorts).Error; err != nil {
		return nil, err
	}
	return funnel, nil
}
