package publicfoodsync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/marketingqr/catalog"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	canteenName = "一食堂"
	floorName   = "二楼"
)

type Report struct {
	DatasetVersion   string         `json:"dataset_version"`
	MerchantName     string         `json:"merchant_name"`
	ProductCount     int            `json:"product_count"`
	ExistingByID     int            `json:"existing_by_id"`
	ExistingByName   int            `json:"existing_by_name"`
	Conflicts        int            `json:"conflicts"`
	WouldInsert      int            `json:"would_insert"`
	WouldBackfill    int            `json:"would_backfill"`
	Inserted         int            `json:"inserted"`
	Backfilled       int            `json:"backfilled"`
	PublishedLinked  int            `json:"published_linked"`
	MapReadyProducts int            `json:"map_ready_products"`
	MapSpotCount     int            `json:"map_spot_count"`
	Directory        DirectoryMatch `json:"directory"`
}

type DirectoryMatch struct {
	SchoolID    string `json:"school_id,omitempty"`
	SchoolName  string `json:"school_name,omitempty"`
	CampusID    string `json:"campus_id,omitempty"`
	CampusName  string `json:"campus_name,omitempty"`
	CanteenID   string `json:"canteen_id,omitempty"`
	CanteenName string `json:"canteen_name,omitempty"`
	WindowID    string `json:"window_id,omitempty"`
	WindowName  string `json:"window_name,omitempty"`
}

type Syncer struct {
	db      *gorm.DB
	dataset catalog.Dataset
}

func New(db *gorm.DB) *Syncer {
	return &Syncer{db: db, dataset: catalog.DatasetSnapshot()}
}

func (s *Syncer) Run(ctx context.Context, apply bool) (Report, error) {
	if s == nil || s.db == nil {
		return Report{}, errors.New("公共食物库同步数据库未配置")
	}
	if apply {
		var report Report
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			report, err = s.run(ctx, tx, true)
			return err
		})
		return report, err
	}
	return s.run(ctx, s.db.WithContext(ctx), false)
}

func (s *Syncer) run(ctx context.Context, db *gorm.DB, apply bool) (Report, error) {
	report := Report{
		DatasetVersion: s.dataset.Version,
		MerchantName:   s.dataset.MerchantName,
		ProductCount:   len(s.dataset.Products),
	}
	directory, err := findDirectory(ctx, db, s.dataset)
	if err != nil {
		return report, err
	}
	report.Directory = directory

	existing, err := loadExisting(ctx, db, s.dataset)
	if err != nil {
		return report, err
	}
	byID, byName := indexExisting(existing)
	now := time.Now()
	for _, product := range s.dataset.Products {
		itemID, ok := catalog.PublicFoodItemID(product.Code)
		if !ok {
			return report, fmt.Errorf("商品 %s 无法生成公共食物库 ID", product.Code)
		}
		if current, exists := byID[itemID]; exists {
			report.ExistingByID++
			if current.Status != "published" {
				report.Conflicts++
				continue
			}
			updates := missingBackfillValues(current, s.dataset, product, directory)
			if len(updates) > 0 {
				report.WouldBackfill++
				if apply {
					updates["updated_at"] = now
					result := db.WithContext(ctx).Table("public_food_library").Where("id = ?", current.ID).Updates(updates)
					if result.Error != nil {
						return report, fmt.Errorf("回填公共食物 %s: %w", product.Name, result.Error)
					}
					if result.RowsAffected > 0 {
						report.Backfilled++
					}
				}
			}
			continue
		}

		if current, exists := firstPublished(byName[product.Name]); exists {
			report.ExistingByName++
			updates := missingBackfillValues(current, s.dataset, product, directory)
			if len(updates) > 0 {
				report.WouldBackfill++
				if apply {
					updates["updated_at"] = now
					result := db.WithContext(ctx).Table("public_food_library").Where("id = ?", current.ID).Updates(updates)
					if result.Error != nil {
						return report, fmt.Errorf("回填同名公共食物 %s: %w", product.Name, result.Error)
					}
					if result.RowsAffected > 0 {
						report.Backfilled++
					}
				}
			}
			continue
		}
		if len(byName[product.Name]) > 0 {
			report.Conflicts++
			continue
		}

		report.WouldInsert++
		if !apply {
			continue
		}
		row, err := buildSeedRow(s.dataset, product, directory, now)
		if err != nil {
			return report, err
		}
		result := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil {
			return report, fmt.Errorf("写入公共食物 %s: %w", product.Name, result.Error)
		}
		if result.RowsAffected > 0 {
			report.Inserted++
		}
	}

	if apply {
		existing, err = loadExisting(ctx, db, s.dataset)
		if err != nil {
			return report, err
		}
		byID, byName = indexExisting(existing)
	}
	mapKeys := map[string]struct{}{}
	for _, product := range s.dataset.Products {
		itemID, _ := catalog.PublicFoodItemID(product.Code)
		current, exists := byID[itemID]
		if !exists {
			current, exists = firstPublished(byName[product.Name])
		}
		if !exists || current.Status != "published" {
			continue
		}
		report.PublishedLinked++
		if validCoordinate(current.Latitude, current.Longitude) {
			report.MapReadyProducts++
			mapKeys[fmt.Sprintf("%.5f:%.5f", *current.Latitude, *current.Longitude)] = struct{}{}
		}
	}
	report.MapSpotCount = len(mapKeys)
	return report, nil
}

type existingPublicFood struct {
	ID                 string         `gorm:"column:id"`
	Status             string         `gorm:"column:status"`
	FoodName           *string        `gorm:"column:food_name"`
	MerchantName       *string        `gorm:"column:merchant_name"`
	ImagePath          *string        `gorm:"column:image_path"`
	ImagePaths         datatypes.JSON `gorm:"column:image_paths"`
	MerchantAddress    *string        `gorm:"column:merchant_address"`
	DetailAddress      *string        `gorm:"column:detail_address"`
	Latitude           *float64       `gorm:"column:latitude"`
	Longitude          *float64       `gorm:"column:longitude"`
	SchoolID           *string        `gorm:"column:school_id"`
	CampusID           *string        `gorm:"column:campus_id"`
	CanteenID          *string        `gorm:"column:canteen_id"`
	WindowID           *string        `gorm:"column:window_id"`
	SchoolName         *string        `gorm:"column:school_name"`
	CampusName         *string        `gorm:"column:campus_name"`
	CanteenName        *string        `gorm:"column:canteen_name"`
	Floor              *string        `gorm:"column:floor"`
	WindowName         *string        `gorm:"column:window_name"`
	Price              *float64       `gorm:"column:price"`
	PriceType          *string        `gorm:"column:price_type"`
	PriceMin           *float64       `gorm:"column:price_min"`
	PriceMax           *float64       `gorm:"column:price_max"`
	PriceUnit          *string        `gorm:"column:price_unit"`
	PortionDescription *string        `gorm:"column:portion_description"`
	CampusLocationText *string        `gorm:"column:campus_location_text"`
}

func loadExisting(ctx context.Context, db *gorm.DB, dataset catalog.Dataset) ([]existingPublicFood, error) {
	ids := make([]string, 0, len(dataset.Products))
	for _, product := range dataset.Products {
		if id, ok := catalog.PublicFoodItemID(product.Code); ok {
			ids = append(ids, id)
		}
	}
	var rows []existingPublicFood
	err := db.WithContext(ctx).Table("public_food_library").
		Select(`id, status, food_name, merchant_name, image_path, image_paths,
			merchant_address, detail_address, latitude, longitude,
			school_id, campus_id, canteen_id, window_id,
			school_name, campus_name, canteen_name, floor, window_name,
			price, price_type, price_min, price_max, price_unit,
			portion_description, campus_location_text`).
		Where("id IN ? OR merchant_name = ?", ids, dataset.MerchantName).
		Order("CASE WHEN status = 'published' THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, created_at DESC NULLS LAST").
		Scan(&rows).Error
	return rows, err
}

func indexExisting(rows []existingPublicFood) (map[string]existingPublicFood, map[string][]existingPublicFood) {
	byID := make(map[string]existingPublicFood, len(rows))
	byName := make(map[string][]existingPublicFood)
	for _, row := range rows {
		byID[row.ID] = row
		name := strings.TrimSpace(value(row.FoodName))
		if name != "" {
			byName[name] = append(byName[name], row)
		}
	}
	return byID, byName
}

func firstPublished(rows []existingPublicFood) (existingPublicFood, bool) {
	for _, row := range rows {
		if row.Status == "published" {
			return row, true
		}
	}
	return existingPublicFood{}, false
}

type publicFoodSeedRow struct {
	ID                 string         `gorm:"column:id;primaryKey"`
	UserID             *string        `gorm:"column:user_id"`
	ImagePath          *string        `gorm:"column:image_path"`
	ImagePaths         datatypes.JSON `gorm:"column:image_paths;type:jsonb"`
	TotalCalories      float64        `gorm:"column:total_calories"`
	TotalProtein       float64        `gorm:"column:total_protein"`
	TotalCarbs         float64        `gorm:"column:total_carbs"`
	TotalFat           float64        `gorm:"column:total_fat"`
	Items              datatypes.JSON `gorm:"column:items;type:jsonb"`
	Description        string         `gorm:"column:description"`
	Insight            string         `gorm:"column:insight"`
	FoodName           string         `gorm:"column:food_name"`
	MerchantName       string         `gorm:"column:merchant_name"`
	MerchantAddress    string         `gorm:"column:merchant_address"`
	DetailAddress      string         `gorm:"column:detail_address"`
	SuitableForFatLoss bool           `gorm:"column:suitable_for_fat_loss"`
	UserTags           datatypes.JSON `gorm:"column:user_tags;type:jsonb"`
	UserNotes          string         `gorm:"column:user_notes"`
	Latitude           float64        `gorm:"column:latitude"`
	Longitude          float64        `gorm:"column:longitude"`
	Province           string         `gorm:"column:province"`
	City               string         `gorm:"column:city"`
	District           string         `gorm:"column:district"`
	Status             string         `gorm:"column:status"`
	Type               string         `gorm:"column:type"`
	PublishedAt        time.Time      `gorm:"column:published_at"`
	LikeCount          int            `gorm:"column:like_count"`
	CommentCount       int            `gorm:"column:comment_count"`
	CollectionCount    int            `gorm:"column:collection_count"`
	AvgRating          float64        `gorm:"column:avg_rating"`
	CreatedAt          time.Time      `gorm:"column:created_at"`
	UpdatedAt          time.Time      `gorm:"column:updated_at"`
	IsCampusFood       bool           `gorm:"column:is_campus_food"`
	SchoolID           *string        `gorm:"column:school_id"`
	CampusID           *string        `gorm:"column:campus_id"`
	CanteenID          *string        `gorm:"column:canteen_id"`
	WindowID           *string        `gorm:"column:window_id"`
	SchoolName         string         `gorm:"column:school_name"`
	CampusName         string         `gorm:"column:campus_name"`
	CanteenName        string         `gorm:"column:canteen_name"`
	Floor              string         `gorm:"column:floor"`
	WindowName         string         `gorm:"column:window_name"`
	Price              *float64       `gorm:"column:price"`
	PriceType          string         `gorm:"column:price_type"`
	PriceMin           *float64       `gorm:"column:price_min"`
	PriceMax           *float64       `gorm:"column:price_max"`
	PriceUnit          string         `gorm:"column:price_unit"`
	PriceCollectedAt   time.Time      `gorm:"column:price_collected_at"`
	PortionDescription string         `gorm:"column:portion_description"`
	CampusLocationText string         `gorm:"column:campus_location_text"`
	ContentVersion     int64          `gorm:"column:content_version"`
	NutritionVersion   int64          `gorm:"column:nutrition_source_version"`
	NutritionStatus    string         `gorm:"column:nutrition_status"`
	AvailabilityStatus string         `gorm:"column:availability_status"`
}

func (publicFoodSeedRow) TableName() string { return "public_food_library" }

func buildSeedRow(dataset catalog.Dataset, product catalog.Product, directory DirectoryMatch, now time.Time) (publicFoodSeedRow, error) {
	id, ok := catalog.PublicFoodItemID(product.Code)
	if !ok {
		return publicFoodSeedRow{}, fmt.Errorf("未知二维码商品: %s", product.Code)
	}
	imagePaths, _ := json.Marshal([]string{product.ImageKey})
	items, _ := json.Marshal([]map[string]any{{
		"name":                   product.Name,
		"calorie":                product.Nutrition.CaloriesKcal,
		"protein":                product.Nutrition.ProteinG,
		"carbs":                  product.Nutrition.CarbsG,
		"fat":                    product.Nutrition.FatG,
		"portion_description":    product.PortionDescription,
		"micronutrient_analysis": "estimated_v1",
		"micronutrient_source":   "marketing_qr_catalog",
		"nutrients": map[string]any{
			"calories": product.Nutrition.CaloriesKcal,
			"protein":  product.Nutrition.ProteinG,
			"carbs":    product.Nutrition.CarbsG,
			"fat":      product.Nutrition.FatG,
		},
	}})
	tags, _ := json.Marshal([]string{"三生晓", product.Category, "营养估算"})
	imagePath := product.ImageKey
	priceType := "range"
	var price *float64
	if product.PriceMin == product.PriceMax {
		priceType = "fixed"
		value := product.PriceMin
		price = &value
	}
	priceMin, priceMax := product.PriceMin, product.PriceMax
	locationText := joinNonEmpty(dataset.SchoolName, directory.CampusName, canteenName, floorName, dataset.MerchantName)
	return publicFoodSeedRow{
		ID: id, ImagePath: &imagePath, ImagePaths: datatypes.JSON(imagePaths),
		TotalCalories: product.Nutrition.CaloriesKcal, TotalProtein: product.Nutrition.ProteinG,
		TotalCarbs: product.Nutrition.CarbsG, TotalFat: product.Nutrition.FatG, Items: datatypes.JSON(items),
		Description: product.Category + "；" + dataset.NutritionNotice,
		Insight:     "当前为首版估算数据，配方、杯型、糖度、冰量或加料变化后应重新核验。",
		FoodName:    product.Name, MerchantName: dataset.MerchantName,
		MerchantAddress: dataset.Address, DetailAddress: dataset.Address,
		UserTags: datatypes.JSON(tags), UserNotes: "门店定位和营养数据均按首版资料估算，后续可在公共食物库修订。",
		Latitude: dataset.Latitude, Longitude: dataset.Longitude,
		Province: "吉林省", City: "长春市", District: "九台区",
		Status: "published", Type: "campus", PublishedAt: now, CreatedAt: now, UpdatedAt: now,
		IsCampusFood: true, SchoolID: pointer(directory.SchoolID), CampusID: pointer(directory.CampusID),
		CanteenID: pointer(directory.CanteenID), WindowID: pointer(directory.WindowID),
		SchoolName: dataset.SchoolName, CampusName: directory.CampusName, CanteenName: canteenName,
		Floor: floorName, WindowName: dataset.MerchantName,
		Price: price, PriceType: priceType, PriceMin: &priceMin, PriceMax: &priceMax,
		PriceUnit: "元/杯", PriceCollectedAt: now, PortionDescription: product.PortionDescription,
		CampusLocationText: locationText, ContentVersion: 1, NutritionVersion: 0,
		NutritionStatus: "pending", AvailabilityStatus: "available",
	}, nil
}

func missingBackfillValues(current existingPublicFood, dataset catalog.Dataset, product catalog.Product, directory DirectoryMatch) map[string]any {
	updates := map[string]any{}
	putMissingText(updates, "food_name", current.FoodName, product.Name)
	putMissingText(updates, "merchant_name", current.MerchantName, dataset.MerchantName)
	putMissingText(updates, "image_path", current.ImagePath, product.ImageKey)
	if jsonArrayEmpty(current.ImagePaths) {
		payload, _ := json.Marshal([]string{product.ImageKey})
		updates["image_paths"] = datatypes.JSON(payload)
	}
	putMissingText(updates, "merchant_address", current.MerchantAddress, dataset.Address)
	putMissingText(updates, "detail_address", current.DetailAddress, dataset.Address)
	if current.Latitude == nil {
		updates["latitude"] = dataset.Latitude
	}
	if current.Longitude == nil {
		updates["longitude"] = dataset.Longitude
	}
	putMissingText(updates, "school_name", current.SchoolName, dataset.SchoolName)
	putMissingText(updates, "campus_name", current.CampusName, directory.CampusName)
	putMissingText(updates, "canteen_name", current.CanteenName, canteenName)
	putMissingText(updates, "floor", current.Floor, floorName)
	putMissingText(updates, "window_name", current.WindowName, dataset.MerchantName)
	putMissingText(updates, "campus_location_text", current.CampusLocationText,
		joinNonEmpty(dataset.SchoolName, directory.CampusName, canteenName, floorName, dataset.MerchantName))
	putMissingPointer(updates, "school_id", current.SchoolID, directory.SchoolID)
	putMissingPointer(updates, "campus_id", current.CampusID, directory.CampusID)
	putMissingPointer(updates, "canteen_id", current.CanteenID, directory.CanteenID)
	putMissingPointer(updates, "window_id", current.WindowID, directory.WindowID)
	putMissingText(updates, "portion_description", current.PortionDescription, product.PortionDescription)
	putMissingText(updates, "price_unit", current.PriceUnit, "元/杯")
	if current.PriceType == nil || strings.TrimSpace(*current.PriceType) == "" || *current.PriceType == "unknown" {
		if product.PriceMin == product.PriceMax {
			updates["price_type"] = "fixed"
		} else {
			updates["price_type"] = "range"
		}
	}
	if current.Price == nil && product.PriceMin == product.PriceMax {
		updates["price"] = product.PriceMin
	}
	if current.PriceMin == nil {
		updates["price_min"] = product.PriceMin
	}
	if current.PriceMax == nil {
		updates["price_max"] = product.PriceMax
	}
	return updates
}

type directoryRow struct {
	ID        string   `gorm:"column:id"`
	Name      string   `gorm:"column:name"`
	SchoolID  *string  `gorm:"column:school_id"`
	CampusID  *string  `gorm:"column:campus_id"`
	CanteenID *string  `gorm:"column:canteen_id"`
	Latitude  *float64 `gorm:"column:latitude"`
	Longitude *float64 `gorm:"column:longitude"`
}

func findDirectory(ctx context.Context, db *gorm.DB, dataset catalog.Dataset) (DirectoryMatch, error) {
	var schools []directoryRow
	if err := db.WithContext(ctx).Table("schools").
		Select("id, name, latitude, longitude").
		Where("name = ? AND status = ? AND location_type = ?", dataset.SchoolName, "active", "university").
		Find(&schools).Error; err != nil {
		return DirectoryMatch{}, fmt.Errorf("查询学校目录: %w", err)
	}
	school, ok := closestDirectoryRow(schools, dataset.Latitude, dataset.Longitude)
	if !ok {
		return DirectoryMatch{SchoolName: dataset.SchoolName, CanteenName: canteenName, WindowName: dataset.MerchantName}, nil
	}
	match := DirectoryMatch{SchoolID: school.ID, SchoolName: school.Name, CanteenName: canteenName, WindowName: dataset.MerchantName}

	var campuses []directoryRow
	if err := db.WithContext(ctx).Table("school_campuses").
		Select("id, name, school_id, latitude, longitude").
		Where("school_id = ? AND status = ?", school.ID, "active").Find(&campuses).Error; err != nil {
		return match, fmt.Errorf("查询校区目录: %w", err)
	}
	if campus, found := closestDirectoryRow(campuses, dataset.Latitude, dataset.Longitude); found {
		match.CampusID, match.CampusName = campus.ID, campus.Name
	}

	var canteens []directoryRow
	query := db.WithContext(ctx).Table("school_canteens").
		Select("id, name, school_id, campus_id, latitude, longitude").
		Where("school_id = ? AND status = ? AND name LIKE ?", school.ID, "active", "%"+canteenName+"%")
	if match.CampusID != "" {
		query = query.Order(gorm.Expr("CASE WHEN campus_id = ? THEN 0 ELSE 1 END", match.CampusID))
	}
	if err := query.Order("CASE WHEN name = '一食堂' THEN 0 ELSE 1 END, name ASC").Find(&canteens).Error; err != nil {
		return match, fmt.Errorf("查询食堂目录: %w", err)
	}
	if len(canteens) == 0 {
		return match, nil
	}
	canteen := canteens[0]
	match.CanteenID, match.CanteenName = canteen.ID, canteen.Name
	if match.CampusID == "" && canteen.CampusID != nil {
		match.CampusID = strings.TrimSpace(*canteen.CampusID)
	}

	var windows []directoryRow
	if err := db.WithContext(ctx).Table("canteen_windows").
		Select("id, name, canteen_id").
		Where("canteen_id = ? AND status = ? AND name LIKE ?", canteen.ID, "active", "%"+dataset.MerchantName+"%").
		Order("CASE WHEN name = '三生晓' THEN 0 ELSE 1 END, name ASC").Find(&windows).Error; err != nil {
		return match, fmt.Errorf("查询档口目录: %w", err)
	}
	if len(windows) > 0 {
		match.WindowID, match.WindowName = windows[0].ID, windows[0].Name
	}
	return match, nil
}

func closestDirectoryRow(rows []directoryRow, latitude, longitude float64) (directoryRow, bool) {
	if len(rows) == 0 {
		return directoryRow{}, false
	}
	best, bestDistance := rows[0], math.MaxFloat64
	for _, row := range rows {
		if !validCoordinate(row.Latitude, row.Longitude) {
			continue
		}
		distance := math.Pow(*row.Latitude-latitude, 2) + math.Pow(*row.Longitude-longitude, 2)
		if distance < bestDistance {
			best, bestDistance = row, distance
		}
	}
	return best, true
}

func validCoordinate(latitude, longitude *float64) bool {
	return latitude != nil && longitude != nil && *latitude >= -90 && *latitude <= 90 &&
		*longitude >= -180 && *longitude <= 180 && !(*latitude == 0 && *longitude == 0)
}

func putMissingText(updates map[string]any, column string, current *string, candidate string) {
	if strings.TrimSpace(candidate) != "" && (current == nil || strings.TrimSpace(*current) == "") {
		updates[column] = strings.TrimSpace(candidate)
	}
}

func putMissingPointer(updates map[string]any, column string, current *string, candidate string) {
	putMissingText(updates, column, current, candidate)
}

func pointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func value(input *string) string {
	if input == nil {
		return ""
	}
	return *input
}

func jsonArrayEmpty(raw datatypes.JSON) bool {
	if len(raw) == 0 {
		return true
	}
	var values []any
	return json.Unmarshal(raw, &values) != nil || len(values) == 0
}

func joinNonEmpty(values ...string) string {
	seen := map[string]struct{}{}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		parts = append(parts, value)
	}
	return strings.Join(parts, " · ")
}
