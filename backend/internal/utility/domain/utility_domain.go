package domain

// ManualFood — table: manual_food_library
type ManualFood struct {
	ID       string  `gorm:"column:id" json:"id"`
	Name     string  `gorm:"column:name" json:"name"`
	Category string  `gorm:"column:category" json:"category"`
	Calories float64 `gorm:"column:calories" json:"calories"`
	Protein  float64 `gorm:"column:protein" json:"protein"`
	Carbs    float64 `gorm:"column:carbs" json:"carbs"`
	Fat      float64 `gorm:"column:fat" json:"fat"`
}

func (ManualFood) TableName() string { return "manual_food_library" }
