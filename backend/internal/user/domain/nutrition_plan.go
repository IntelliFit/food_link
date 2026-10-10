package domain

// NutritionPlanValues contains reusable targets. In profile mode Targets holds
// macros only; micronutrients are resolved when a day/default snapshot is made.
type NutritionPlanValues struct {
	Name      string             `json:"name"`
	Targets   map[string]float64 `json:"targets"`
	MicroMode string             `json:"micro_mode"`
	FatMin    float64            `json:"fat_min"`
	FatMax    float64            `json:"fat_max"`
	AutoCarb  bool               `json:"auto_carb"`
	Style     string             `json:"style,omitempty"`
}

type NutritionPlan struct {
	NutritionPlanValues
	ID       string `json:"id"`
	Revision int    `json:"revision"`
}

// Snapshot owns all effective values; it never follows an edited/deleted plan.
type NutritionPlanSnapshot struct {
	NutritionPlanValues
	PlanID   string `json:"plan_id"`
	Revision int    `json:"revision"`
}

type NutritionDay struct {
	Date                string                `json:"date"`
	Snapshot            NutritionPlanSnapshot `json:"snapshot"`
	Source              string                `json:"source"`
	HistoricalReference bool                  `json:"historical_reference"`
	ChangeToken         string                `json:"change_token"`
}

type NutritionDayBackup struct {
	Snapshot NutritionPlanSnapshot `json:"snapshot"`
	Source   string                `json:"source"`
}

type NutritionDayChange struct {
	Day      NutritionDay        `json:"day"`
	Previous *NutritionDayBackup `json:"previous"`
}

type NutritionPlanLibrary struct {
	Plans       []NutritionPlan    `json:"plans"`
	DefaultID   string             `json:"default_id"`
	BaseTargets map[string]float64 `json:"base_targets"`
}

type ChangeNutritionDayInput struct {
	PlanID        string               `json:"plan_id"`
	Values        *NutritionPlanValues `json:"values"`
	Restore       *NutritionDayBackup  `json:"restore"`
	Clear         bool                 `json:"clear"`
	ExpectedToken *string              `json:"expected_token"`
}
