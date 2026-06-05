package domain

import "time"

type PublicFoodItem struct {
	ID                 string           `gorm:"column:id" json:"id"`
	UserID             string           `gorm:"column:user_id" json:"user_id"`
	SourceRecordID     *string          `gorm:"column:source_record_id" json:"source_record_id,omitempty"`
	ImagePath          *string          `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths         []string         `gorm:"column:image_paths;serializer:json" json:"image_paths"`
	TotalCalories      float64          `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein       float64          `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs         float64          `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat           float64          `gorm:"column:total_fat" json:"total_fat"`
	Items              []map[string]any `gorm:"column:items;serializer:json" json:"items"`
	Description        string           `gorm:"column:description" json:"description"`
	Insight            string           `gorm:"column:insight" json:"insight"`
	FoodName           string           `gorm:"column:food_name" json:"food_name"`
	MerchantName       string           `gorm:"column:merchant_name" json:"merchant_name"`
	MerchantAddress    string           `gorm:"column:merchant_address" json:"merchant_address"`
	DetailAddress      string           `gorm:"column:detail_address" json:"detail_address"`
	TasteRating        *int             `gorm:"column:taste_rating" json:"taste_rating,omitempty"`
	SuitableForFatLoss bool             `gorm:"column:suitable_for_fat_loss" json:"suitable_for_fat_loss"`
	UserTags           []string         `gorm:"column:user_tags;serializer:json" json:"user_tags"`
	UserNotes          string           `gorm:"column:user_notes" json:"user_notes"`
	Latitude           *float64         `gorm:"column:latitude" json:"latitude,omitempty"`
	Longitude          *float64         `gorm:"column:longitude" json:"longitude,omitempty"`
	Province           string           `gorm:"column:province" json:"province"`
	City               string           `gorm:"column:city" json:"city"`
	District           string           `gorm:"column:district" json:"district"`
	Status             string           `gorm:"column:status" json:"status"`
	AuditRejectReason  *string          `gorm:"column:audit_reject_reason" json:"audit_reject_reason,omitempty"`
	PublishedAt        *time.Time       `gorm:"column:published_at" json:"published_at,omitempty"`
	LikeCount          int              `gorm:"column:like_count" json:"like_count"`
	CommentCount       int              `gorm:"column:comment_count" json:"comment_count"`
	CollectionCount    int              `gorm:"column:collection_count" json:"collection_count"`
	AvgRating          float64          `gorm:"column:avg_rating" json:"avg_rating"`
	CreatedAt          *time.Time       `gorm:"column:created_at" json:"created_at"`
	UpdatedAt          *time.Time       `gorm:"column:updated_at" json:"updated_at"`
	// Campus canteen fields
	IsCampusFood       bool             `gorm:"column:is_campus_food" json:"is_campus_food"`
	SchoolName         string           `gorm:"column:school_name" json:"school_name,omitempty"`
	CampusName         string           `gorm:"column:campus_name" json:"campus_name,omitempty"`
	CanteenName        string           `gorm:"column:canteen_name" json:"canteen_name,omitempty"`
	Floor              string           `gorm:"column:floor" json:"floor,omitempty"`
	WindowName         string           `gorm:"column:window_name" json:"window_name,omitempty"`
	Price              float64          `gorm:"column:price" json:"price,omitempty"`
	PriceType          string           `gorm:"column:price_type" json:"price_type,omitempty"`
	PriceMin           float64          `gorm:"column:price_min" json:"price_min,omitempty"`
	PriceMax           float64          `gorm:"column:price_max" json:"price_max,omitempty"`
	PriceUnit          string           `gorm:"column:price_unit" json:"price_unit,omitempty"`
	PriceCollectedAt   *time.Time       `gorm:"column:price_collected_at" json:"price_collected_at,omitempty"`
	PortionDescription string           `gorm:"column:portion_description" json:"portion_description,omitempty"`
	IsCampusHighlight  bool             `gorm:"column:is_campus_highlight" json:"is_campus_highlight"`
	CampusLocationText string           `gorm:"column:campus_location_text" json:"campus_location_text,omitempty"`
}

func (PublicFoodItem) TableName() string { return "public_food_library" }

type PublicFoodLike struct {
	ID            string     `gorm:"column:id"`
	UserID        string     `gorm:"column:user_id"`
	LibraryItemID string     `gorm:"column:library_item_id"`
	CreatedAt     *time.Time `gorm:"column:created_at"`
}

func (PublicFoodLike) TableName() string { return "public_food_library_likes" }

type PublicFoodCollection struct {
	ID            string     `gorm:"column:id"`
	UserID        string     `gorm:"column:user_id"`
	LibraryItemID string     `gorm:"column:library_item_id"`
	CreatedAt     *time.Time `gorm:"column:created_at"`
}

func (PublicFoodCollection) TableName() string { return "public_food_library_collections" }

type PublicFoodComment struct {
	ID            string     `gorm:"column:id" json:"id"`
	UserID        string     `gorm:"column:user_id" json:"user_id"`
	LibraryItemID string     `gorm:"column:library_item_id" json:"library_item_id"`
	Content       string     `gorm:"column:content" json:"content"`
	Rating        *int       `gorm:"column:rating" json:"rating,omitempty"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at"`
	Nickname      string     `gorm:"-" json:"nickname"`
	Avatar        string     `gorm:"-" json:"avatar"`
}

func (PublicFoodComment) TableName() string { return "public_food_library_comments" }

type PublicFoodFeedback struct {
	ID            string     `gorm:"column:id" json:"id"`
	UserID        string     `gorm:"column:user_id" json:"user_id"`
	LibraryItemID *string    `gorm:"column:library_item_id" json:"library_item_id,omitempty"`
	Content       string     `gorm:"column:content" json:"content"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at"`
}

func (PublicFoodFeedback) TableName() string { return "public_food_library_feedback" }

type Author struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

type PublicFoodView struct {
	PublicFoodItem
	Liked           bool   `json:"liked"`
	Collected       bool   `json:"collected"`
	Author          Author `json:"author"`
	RecommendReason string `json:"recommend_reason,omitempty"`
}
