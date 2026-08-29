package domain

import "time"

const (
	ComponentCategoryNutrient   = "nutrient"
	ComponentCategoryFunctional = "functional"
	ComponentCategoryBlend      = "blend"
)

// Component describes one label-declared substance per product serving.
// NutrientKey links ordinary nutrients to the existing food nutrient ledger;
// functional ingredients and undisclosed blends intentionally keep it empty.
type Component struct {
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Amount      float64 `json:"amount"`
	Unit        string  `json:"unit"`
	NutrientKey string  `json:"nutrient_key,omitempty"`
	Form        string  `json:"form,omitempty"`
}

// SupplementCatalogItem is a system-maintained template that users can copy
// into their own cabinet. It is intentionally separate from UserSupplement:
// the catalog is shared, while dosage plans and later edits belong to a user.
type SupplementCatalogItem struct {
	ID           string      `gorm:"column:id;primaryKey" json:"id"`
	Name         string      `gorm:"column:name" json:"name"`
	Category     string      `gorm:"column:category" json:"category"`
	Description  string      `gorm:"column:description" json:"description"`
	Brand        string      `gorm:"column:brand" json:"brand"`
	ImageURL     *string     `gorm:"column:image_url" json:"image_url,omitempty"`
	ServingLabel string      `gorm:"column:serving_label" json:"serving_label"`
	Components   []Component `gorm:"column:components;serializer:json" json:"components"`
	SearchTerms  string      `gorm:"column:search_terms" json:"-"`
	SortOrder    int         `gorm:"column:sort_order" json:"sort_order"`
	Status       string      `gorm:"column:status" json:"status"`
	CreatedAt    time.Time   `gorm:"column:created_at" json:"created_at"`
	UpdatedAt    time.Time   `gorm:"column:updated_at" json:"updated_at"`
}

func (SupplementCatalogItem) TableName() string { return "supplement_catalog_items" }

type UserSupplement struct {
	ID               string      `gorm:"column:id;primaryKey" json:"id"`
	UserID           string      `gorm:"column:user_id" json:"user_id"`
	Name             string      `gorm:"column:name" json:"name"`
	Brand            string      `gorm:"column:brand" json:"brand"`
	Barcode          *string     `gorm:"column:barcode" json:"barcode,omitempty"`
	ImageURL         *string     `gorm:"column:image_url" json:"image_url,omitempty"`
	ImageURLs        []string    `gorm:"column:image_urls;serializer:json" json:"image_urls"`
	DefaultServings  float64     `gorm:"column:default_servings" json:"default_servings"`
	ServingLabel     string      `gorm:"column:serving_label" json:"serving_label"`
	ScheduleEnabled  bool        `gorm:"column:schedule_enabled" json:"schedule_enabled"`
	ScheduleTime     *string     `gorm:"column:schedule_time" json:"schedule_time,omitempty"`
	ScheduleDays     []int       `gorm:"column:schedule_days;serializer:json" json:"schedule_days"`
	Components       []Component `gorm:"column:components;serializer:json" json:"components"`
	LabelConfirmedAt *time.Time  `gorm:"column:label_confirmed_at" json:"label_confirmed_at,omitempty"`
	Status           string      `gorm:"column:status" json:"status"`
	CreatedAt        time.Time   `gorm:"column:created_at" json:"created_at"`
	UpdatedAt        time.Time   `gorm:"column:updated_at" json:"updated_at"`
}

func (UserSupplement) TableName() string { return "user_supplements" }

type SupplementIntake struct {
	ID                 string      `gorm:"column:id;primaryKey" json:"id"`
	UserID             string      `gorm:"column:user_id" json:"user_id"`
	SupplementID       string      `gorm:"column:supplement_id" json:"supplement_id"`
	SupplementName     string      `gorm:"column:supplement_name" json:"supplement_name"`
	Servings           float64     `gorm:"column:servings" json:"servings"`
	ServingLabel       string      `gorm:"column:serving_label" json:"serving_label"`
	ComponentsSnapshot []Component `gorm:"column:components_snapshot;serializer:json" json:"components"`
	TakenAt            time.Time   `gorm:"column:taken_at" json:"taken_at"`
	Source             string      `gorm:"column:source" json:"source"`
	Note               *string     `gorm:"column:note" json:"note,omitempty"`
	IdempotencyKey     *string     `gorm:"column:idempotency_key" json:"-"`
	CreatedAt          time.Time   `gorm:"column:created_at" json:"created_at"`
}

func (SupplementIntake) TableName() string { return "supplement_intakes" }
