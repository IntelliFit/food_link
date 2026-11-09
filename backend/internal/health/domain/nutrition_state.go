package domain

// The daily nutrition state is the one reading of a user's diet that the meal Agent,
// the analysis page, the pet and the record result page all share, so they never
// disagree. The diet decision engine computes it per user and day from the plan,
// what was eaten, the last weeks of records and the rest of the user's context.
// GET /api/health/nutrition-state?date=YYYY-MM-DD returns it as JSON;
// docs/algorithms/daily-nutrition-state.md describes every field.

// Nutrient statuses. Unknown is never counted as zero: a meal without sodium data
// leaves sodium unknown, not low.
const (
	NutrientStatusOK        = "ok"
	NutrientStatusShort     = "short"
	NutrientStatusNearLimit = "near_limit"
	NutrientStatusOver      = "over"
	NutrientStatusUnknown   = "unknown"
)

// Habit marks for one day of the week view.
const (
	HabitMarkHit   = "hit"
	HabitMarkMiss  = "miss"
	HabitMarkToday = "today"
	HabitMarkNone  = "none"
)

type DailyNutritionState struct {
	Date         string                 `json:"date"`
	GeneratedAt  string                 `json:"generated_at"`
	Coverage     NutritionCoverage      `json:"coverage"`
	Plan         NutritionPlanSummary   `json:"plan"`
	Today        []NutrientReading      `json:"today"`
	Gaps         []NutritionGap         `json:"gaps"`
	NextMeal     *NutritionNextMeal     `json:"next_meal"`
	Week         NutritionWeek          `json:"week"`
	Scores       NutritionScores        `json:"scores"`
	EvidenceGaps []NutritionEvidenceGap `json:"evidence_gaps"`
	Context      NutritionContext       `json:"context"`
	Headline     string                 `json:"headline"`
	// Focus is what the user said they care about (up to three, in their order); gaps,
	// the next meal, the focus cards and the headline put these first.
	Focus    []NutritionFocusChoice `json:"focus"`
	Findings []NutritionFinding     `json:"findings"`
}

type NutritionCoverage struct {
	RecordedDays         int     `json:"recorded_days"`
	Meals                int     `json:"meals"`
	TodayMeals           int     `json:"today_meals"`
	NutrientCompleteness float64 `json:"nutrient_completeness"`
	EnoughData           bool    `json:"enough_data"`
}

type NutritionPlanSummary struct {
	Goal       string  `json:"goal"`
	GoalLabel  string  `json:"goal_label"`
	EnergyKcal float64 `json:"energy_kcal"`
	ProteinG   float64 `json:"protein_g"`
	Source     string  `json:"source"`
}

// NutrientReading is one line of "今天还差什么". Kind "min" is a floor to reach,
// "max" a ceiling to stay under, "range" both.
type NutrientReading struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	Unit         string   `json:"unit"`
	Value        *float64 `json:"value"`
	Target       float64  `json:"target"`
	Kind         string   `json:"kind"`
	Status       string   `json:"status"`
	Gap          float64  `json:"gap"`
	UnknownMeals int      `json:"unknown_meals"`
}

type NutritionGap struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	Text     string  `json:"text"`
	Severity float64 `json:"severity"`
}

type NutritionNextMeal struct {
	MealType string   `json:"meal_type"`
	Label    string   `json:"label"`
	Advice   string   `json:"advice"`
	Fills    []string `json:"fills"`
	Limits   []string `json:"limits"`
}

type NutritionWeek struct {
	Days       []string             `json:"days"`
	Habits     []NutritionHabit     `json:"habits"`
	Counts     []NutritionCount     `json:"counts"`
	VsLastWeek []NutritionWeekDelta `json:"vs_last_week"`
}

type NutritionHabit struct {
	Key   string   `json:"key"`
	Label string   `json:"label"`
	Marks []string `json:"marks"`
	Hit   int      `json:"hit"`
	Of    int      `json:"of"`
}

type NutritionCount struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Value  float64 `json:"value"`
	Target float64 `json:"target"`
	Unit   string  `json:"unit"`
}

type NutritionWeekDelta struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Last   float64 `json:"last"`
	This   float64 `json:"this"`
	Unit   string  `json:"unit"`
	Better bool    `json:"better"`
}

type NutritionScores struct {
	Overall         *int                  `json:"overall"`
	OverallLastWeek *int                  `json:"overall_last_week"`
	Focus           []NutritionFocusScore `json:"focus"`
}

// NutritionFocusChoice is one of the user's chosen focuses: a focus card key, or
// "custom:<id>" for a custom focus (Custom true).
type NutritionFocusChoice struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Custom bool   `json:"custom"`
}

// NutritionFocusScore keeps the keys of the analysis page's focus cards
// in health_index.go (hypertension, diabetes, cardio, weight, colorectal, longevity, micronutrient).
type NutritionFocusScore struct {
	Key      string   `json:"key"`
	Title    string   `json:"title"`
	Score    *int     `json:"score"`
	Reason   string   `json:"reason"`
	Evidence []string `json:"evidence"`
}

// NutritionEvidenceGap is something the state cannot judge yet and the record that
// would fix it. Action: record, weight, water, sleep or none.
type NutritionEvidenceGap struct {
	Key    string `json:"key"`
	Text   string `json:"text"`
	Hint   string `json:"hint"`
	Action string `json:"action"`
}

type NutritionContext struct {
	WeightTrend   *NutritionWeightTrend `json:"weight_trend"`
	TrainingToday bool                  `json:"training_today"`
	WaterMLToday  *float64              `json:"water_ml_today"`
	SleepHours    *float64              `json:"sleep_hours"`
	Notes         []string              `json:"notes"`
}

type NutritionWeightTrend struct {
	KgChange float64 `json:"kg_change"`
	Days     int     `json:"days"`
}

// NutritionFinding is one grounded fact behind the headline, for the pet or a model
// to put in its own words without inventing numbers.
type NutritionFinding struct {
	Key   string `json:"key"`
	Kind  string `json:"kind"`
	Text  string `json:"text"`
	Value string `json:"value,omitempty"`
}

// MealImpact is what one saved record changed in its day:
// GET /api/health/nutrition-state/meal-impact?record_id=...
type MealImpact struct {
	RecordID string             `json:"record_id"`
	Date     string             `json:"date"`
	MealType string             `json:"meal_type"`
	Changes  []MealImpactChange `json:"changes"`
	Headline string             `json:"headline"`
}

type MealImpactChange struct {
	Key    string   `json:"key"`
	Label  string   `json:"label"`
	Unit   string   `json:"unit"`
	Before *float64 `json:"before"`
	After  *float64 `json:"after"`
	Delta  *float64 `json:"delta"`
	Target float64  `json:"target"`
	Kind   string   `json:"kind"`
	Status string   `json:"status"`
}
