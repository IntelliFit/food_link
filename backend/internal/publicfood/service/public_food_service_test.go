package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	frienddomain "food_link/backend/internal/friend/domain"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/testdb"

	"gorm.io/gorm"
)

type mockPublicFoodRewardAwarder struct {
	called bool
	meta   map[string]any
}

type mockCampusMembershipChecker struct {
	allowed bool
	err     error
}

func (m *mockCampusMembershipChecker) IsCampusPublishingAllowed(context.Context, string) (bool, error) {
	return m.allowed, m.err
}

func allowCampusPublishing(svc *PublicFoodService) {
	svc.ConfigureCampusMembershipChecker(&mockCampusMembershipChecker{allowed: true})
}

func TestPublicFoodServiceCreateCampusFoodFailsClosedWithoutMembershipChecker(t *testing.T) {
	svc := NewPublicFoodService(nil)
	_, err := svc.Create(context.Background(), "user-1", CreateInput{IsCampusFood: true})
	require.ErrorIs(t, err, commonerrors.ErrInternal)
}

func TestPublicFoodServiceCreateCampusFoodRejectsNonMember(t *testing.T) {
	svc := NewPublicFoodService(nil)
	svc.ConfigureCampusMembershipChecker(&mockCampusMembershipChecker{allowed: false})
	_, err := svc.Create(context.Background(), "user-1", CreateInput{IsCampusFood: true})
	require.Error(t, err)
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 403, appErr.HTTPStatus)
	require.Equal(t, "校园食物发布仅限会员", appErr.Message)
}

type recordingPublicFoodTaskPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingPublicFoodTaskPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

func (m *mockPublicFoodRewardAwarder) AwardPublicFoodUpload(ctx context.Context, userID, publicFoodItemID string, meta map[string]any) (map[string]any, error) {
	m.called = true
	m.meta = meta
	return map[string]any{"ok": true}, nil
}

func setupPublicFoodServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&domain.PublicFoodItem{},
		&analyzedomain.AnalysisTask{},
		&analyzedomain.PrecisionSession{},
		&analyzedomain.PrecisionSessionRound{},
		&authrepo.User{},
		&frienddomain.UserBlock{},
		&domain.PublicFoodLike{},
		&domain.PublicFoodCollection{},
		&domain.PublicFoodComment{},
	))
	require.NoError(t, db.Exec(`
		ALTER TABLE analysis_tasks ALTER COLUMN result TYPE jsonb USING result::jsonb
	`).Error)
	require.NoError(t, db.Exec(`
		ALTER TABLE public_food_library ALTER COLUMN items TYPE jsonb USING items::jsonb
	`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE schools (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		province TEXT,
		city TEXT,
		level TEXT,
		is_985 INTEGER,
		is_211 INTEGER,
		status TEXT NOT NULL DEFAULT 'active',
		logo_url TEXT,
		created_at TEXT
	)`).Error)
	return db
}

func TestValidateCampusCreateInputRequiresCoreFields(t *testing.T) {
	foodName := "鸡胸肉套餐"
	school := "北京大学"
	canteen := "学一食堂"
	image := "https://example.com/food.jpg"

	tests := []struct {
		name  string
		input CreateInput
	}{
		{
			name: "missing school",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				CanteenName:  &canteen,
				ImagePath:    &image,
			},
		},
		{
			name: "missing canteen",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				ImagePath:    &image,
			},
		},
		{
			name: "missing image",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				CanteenName:  &canteen,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			imagePaths := []string{}
			if tt.input.ImagePath != nil {
				imagePaths = append(imagePaths, *tt.input.ImagePath)
			}
			err := validateCampusCreateInput(tt.input, imagePaths)
			require.Error(t, err)
		})
	}

	err := validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		ImagePath:    &image,
	}, []string{image})
	require.NoError(t, err)
}

func TestValidateCampusRangePrice(t *testing.T) {
	priceType := "range"
	foodName := "麻辣烫"
	school := "北京大学"
	canteen := "学一食堂"
	imagePaths := []string{"https://example.com/food.jpg"}
	minPrice := 8.0
	maxPrice := 15.0

	err := validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		PriceType:    &priceType,
		PriceMin:     &minPrice,
		PriceMax:     &maxPrice,
	}, imagePaths)
	require.NoError(t, err)

	badMax := 6.0
	err = validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		PriceType:    &priceType,
		PriceMin:     &minPrice,
		PriceMax:     &badMax,
	}, imagePaths)
	require.Error(t, err)
}

func TestHasCampusPrice(t *testing.T) {
	require.False(t, hasCampusPrice(nil))
	require.False(t, hasCampusPrice(&domain.PublicFoodItem{}))
	require.True(t, hasCampusPrice(&domain.PublicFoodItem{Price: 12}))
	require.True(t, hasCampusPrice(&domain.PublicFoodItem{PriceMin: 8, PriceMax: 15}))
}

func TestContributeCampusImagesAcceptsFirstContributionWithoutChangingNutrition(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	calories := 428.0
	item := domain.PublicFoodItem{
		ID: "campus-missing-image", UserID: "system-user", Status: "published", Type: "campus", IsCampusFood: true,
		FoodName: "番茄炒饭", SchoolName: "清华大学", CanteenName: "紫荆园", TotalCalories: calories,
		ImagePaths: []string{}, Items: []map[string]any{}, UserTags: []string{},
	}
	repository := repo.NewPublicFoodRepo(db)
	require.NoError(t, repository.CreateItem(context.Background(), &item))
	svc := NewPublicFoodService(repository)

	first, err := svc.ContributeCampusImages(context.Background(), "user-1", item.ID, []string{"campus-food/first.jpg"})
	require.NoError(t, err)
	require.True(t, first.Accepted)
	require.Equal(t, []string{"campus-food/first.jpg"}, first.ImagePaths)

	second, err := svc.ContributeCampusImages(context.Background(), "user-2", item.ID, []string{"campus-food/second.jpg"})
	require.NoError(t, err)
	require.False(t, second.Accepted)
	require.Equal(t, []string{"campus-food/first.jpg"}, second.ImagePaths)

	saved, err := repository.GetItem(context.Background(), item.ID)
	require.NoError(t, err)
	require.Equal(t, calories, saved.TotalCalories)
	require.Equal(t, []string{"campus-food/first.jpg"}, saved.ImagePaths)
}

func TestContributeCampusImagesRejectsExternalImageAndNonCampusItem(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	repository := repo.NewPublicFoodRepo(db)
	svc := NewPublicFoodService(repository)

	_, err := svc.ContributeCampusImages(context.Background(), "user-1", "missing", []string{"https://untrusted.example.com/photo.jpg"})
	require.Error(t, err)

	item := domain.PublicFoodItem{
		ID: "common-missing-image", UserID: "user-1", Status: "published", Type: "common",
		FoodName: "家常菜", ImagePaths: []string{}, Items: []map[string]any{}, UserTags: []string{},
	}
	require.NoError(t, repository.CreateItem(context.Background(), &item))
	_, err = svc.ContributeCampusImages(context.Background(), "user-1", item.ID, []string{"food-images/common.jpg"})
	require.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestNormalizePublicFoodLocationInputHomemadeOnlyRequiresProvinceCity(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	district := "西湖区"
	merchantName := "不应该保存的商家"
	merchantAddress := "不应该保存的地址"
	detailAddress := "不应该保存的详细地址"
	latitude := 30.25
	longitude := 120.16
	priceType := "fixed"
	price := 12.0

	input := CreateInput{
		UserTags:        []string{"自制"},
		Province:        &province,
		City:            &city,
		District:        &district,
		MerchantName:    &merchantName,
		MerchantAddress: &merchantAddress,
		DetailAddress:   &detailAddress,
		Latitude:        &latitude,
		Longitude:       &longitude,
		Price:           &price,
		PriceType:       &priceType,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
	require.Nil(t, input.MerchantName)
	require.Nil(t, input.MerchantAddress)
	require.Nil(t, input.DetailAddress)
	require.Nil(t, input.District)
	require.Nil(t, input.Latitude)
	require.Nil(t, input.Longitude)
	require.Nil(t, input.Price)
	require.Nil(t, input.PriceType)
}

func TestNormalizePublicFoodLocationInputHomemadeLocationOptional(t *testing.T) {
	input := CreateInput{
		UserTags: []string{"自制"},
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
}

func TestNormalizePublicFoodLocationInputNonHomemadeRequiresFullLocation(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	input := CreateInput{
		Province: &province,
		City:     &city,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.Error(t, err)
}

func TestNormalizePublicFoodLocationInputNonCampusClearsPriceFields(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	district := "西湖区"
	latitude := 30.25
	longitude := 120.16
	priceType := "fixed"
	price := 12.0
	input := CreateInput{
		Province:  &province,
		City:      &city,
		District:  &district,
		Latitude:  &latitude,
		Longitude: &longitude,
		Price:     &price,
		PriceType: &priceType,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
	require.Nil(t, input.Price)
	require.Nil(t, input.PriceType)
}

func TestPublicFoodServiceCreateCampusFoodPublishesAndStoresCampusFields(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	publicFoodRepo := repo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	analyzeTaskSvc := analyzeservice.NewTaskService(taskRepo, precisionRepo, authrepo.NewUserRepo(db))
	svc := NewPublicFoodService(publicFoodRepo)
	allowCampusPublishing(svc)
	awarder := &mockPublicFoodRewardAwarder{}
	publisher := &recordingPublicFoodTaskPublisher{}
	analyzeTaskSvc.ConfigureTaskPublisher(publisher)
	svc.ConfigureCampusAnalyzeTaskSubmitter(analyzeTaskSvc)
	svc.ConfigureRewardTaskAwarder(awarder)
	ctx := context.Background()

	foodName := "鸡胸肉套餐"
	school := "北京大学"
	campus := "燕园校区"
	canteen := "学一食堂"
	floor := "一层"
	window := "低脂窗口"
	image := "https://example.com/campus-food.jpg"
	price := 16.5
	priceType := "fixed"
	priceUnit := "份"
	portion := "一荤一素"

	id, err := svc.Create(ctx, "user-1", CreateInput{
		IsCampusFood:       true,
		FoodName:           &foodName,
		SchoolName:         &school,
		CampusName:         &campus,
		CanteenName:        &canteen,
		Floor:              &floor,
		WindowName:         &window,
		ImagePath:          &image,
		TotalCalories:      420,
		TotalProtein:       38,
		Price:              &price,
		PriceType:          &priceType,
		PriceUnit:          &priceUnit,
		PortionDescription: &portion,
	})

	require.NoError(t, err)
	require.NotEmpty(t, id)

	var saved domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", id).First(&saved).Error)
	require.Equal(t, "pending", saved.Status)
	require.Nil(t, saved.PublishedAt)
	require.True(t, saved.IsCampusFood)
	require.Equal(t, school, saved.SchoolName)
	require.Equal(t, campus, saved.CampusName)
	require.Equal(t, canteen, saved.CanteenName)
	require.Equal(t, floor, saved.Floor)
	require.Equal(t, window, saved.WindowName)
	require.Equal(t, "北京大学 · 燕园校区 · 学一食堂 · 一层 · 低脂窗口", saved.CampusLocationText)
	require.Equal(t, price, saved.Price)
	require.Equal(t, priceType, saved.PriceType)
	require.Equal(t, priceUnit, saved.PriceUnit)
	require.Equal(t, portion, saved.PortionDescription)
	require.NotNil(t, saved.PriceCollectedAt)
	require.NotNil(t, saved.AnalysisTaskID)

	var task analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", *saved.AnalysisTaskID).First(&task).Error)
	require.Equal(t, "food", task.TaskType)
	require.Equal(t, "pending", task.Status)
	require.Equal(t, image, *task.ImageURL)
	require.Equal(t, []string{image}, task.ImagePaths)
	require.Equal(t, id, task.Payload["public_food_item_id"])
	require.Equal(t, "campus_public_food", task.Payload["public_food_source_type"])
	require.Equal(t, true, task.Payload["micronutrient_analysis_required"])
	require.Equal(t, "image", task.Payload["source_type"])
	require.Equal(t, "standard", task.Payload["execution_mode"])
	require.Empty(t, task.Payload["precision_session_id"])
	require.Len(t, publisher.messages, 1)
	require.Equal(t, task.ID, publisher.messages[0].TaskID)
	require.Equal(t, "food", publisher.messages[0].TaskType)
	require.True(t, awarder.called)
	require.Equal(t, true, awarder.meta["is_campus_food"])
	require.Equal(t, school, awarder.meta["school_name"])
	require.Equal(t, canteen, awarder.meta["canteen_name"])
}

func TestPublicFoodServiceCreateCampusFoodAcceptsPostedPayloadWithoutItems(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	publicFoodRepo := repo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	analyzeTaskSvc := analyzeservice.NewTaskService(taskRepo, precisionRepo, authrepo.NewUserRepo(db))
	publisher := &recordingPublicFoodTaskPublisher{}
	analyzeTaskSvc.ConfigureTaskPublisher(publisher)
	svc := NewPublicFoodService(publicFoodRepo)
	allowCampusPublishing(svc)
	svc.ConfigureCampusAnalyzeTaskSubmitter(analyzeTaskSvc)
	ctx := context.Background()

	imageURL := "http://cdn-food-images.coachlink.fit/2ff8d285-09e3-4b24-9dee-19861259a8c4.jpg"
	foodName := "锦恢蜜汁拿铁"
	schoolName := "中国科学技术大学"
	canteenName := "测试"
	floor := "1"
	windowName := "1"
	price := 10.0
	priceType := "fixed"
	priceUnit := "元/份"
	collectedAt := time.Date(2026, 6, 7, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	portion := "中杯"

	itemID, err := svc.Create(ctx, "user-1", CreateInput{
		ImagePath:          &imageURL,
		ImagePaths:         []string{imageURL},
		FoodName:           &foodName,
		SuitableForFatLoss: true,
		UserTags:           []string{},
		IsCampusFood:       true,
		SchoolName:         &schoolName,
		CanteenName:        &canteenName,
		Floor:              &floor,
		WindowName:         &windowName,
		Price:              &price,
		PriceType:          &priceType,
		PriceUnit:          &priceUnit,
		PriceCollectedAt:   &collectedAt,
		PortionDescription: &portion,
	})

	require.NoError(t, err)
	require.NotEmpty(t, itemID)
	var saved domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", itemID).First(&saved).Error)
	require.Equal(t, "pending", saved.Status)
	require.Nil(t, saved.PublishedAt)
	require.Equal(t, []map[string]any{}, saved.Items)
	require.Equal(t, []string{}, saved.UserTags)
	require.Equal(t, 0.0, saved.TotalCalories)
	require.NotNil(t, saved.AnalysisTaskID)
	require.Equal(t, "中国科学技术大学 · 测试 · 1 · 1", saved.CampusLocationText)

	var task analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", *saved.AnalysisTaskID).First(&task).Error)
	require.Equal(t, "food", task.TaskType)
	require.Equal(t, "standard", task.Payload["execution_mode"])
	require.Equal(t, "campus_public_food", task.Payload["public_food_source_type"])
	require.Equal(t, true, task.Payload["micronutrient_analysis_required"])
	require.Equal(t, itemID, task.Payload["public_food_item_id"])
	require.Len(t, publisher.messages, 1)
	require.Equal(t, task.ID, publisher.messages[0].TaskID)
}

func TestPublicFoodServiceCreateCampusFoodRequiresCoreFields(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	allowCampusPublishing(svc)
	ctx := context.Background()

	foodName := "鸡胸肉套餐"
	school := "北京大学"
	canteen := "学一食堂"
	image := "https://example.com/campus-food.jpg"

	tests := []struct {
		name  string
		input CreateInput
	}{
		{
			name: "missing school",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				CanteenName:  &canteen,
				ImagePath:    &image,
			},
		},
		{
			name: "missing canteen",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				ImagePath:    &image,
			},
		},
		{
			name: "missing image",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				CanteenName:  &canteen,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, err := svc.Create(ctx, "user-1", tt.input)

			require.Error(t, err)
			require.Empty(t, id)
		})
	}
}

func TestPublicFoodServiceGetCampusDetailAggregatesRelatedData(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	publicFoodRepo := repo.NewPublicFoodRepo(db)
	svc := NewPublicFoodService(publicFoodRepo)
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&authrepo.User{ID: "user-1", Nickname: "贡献者"}).Error)
	rows := []domain.PublicFoodItem{
		{
			ID:            "campus-1",
			UserID:        "user-1",
			FoodName:      "鸡胸肉套餐",
			Status:        "published",
			IsCampusFood:  true,
			SchoolName:    "北京大学",
			CanteenName:   "学一食堂",
			Floor:         "一层",
			WindowName:    "低脂窗口",
			TotalCalories: 420,
			TotalProtein:  38,
			Items:         preciseCampusItemsForServiceTest(),
			Price:         16,
			PublishedAt:   &now,
			CreatedAt:     &now,
		},
		{
			ID:                "campus-2",
			UserID:            "user-1",
			FoodName:          "低脂牛肉饭",
			Status:            "published",
			IsCampusFood:      true,
			IsCampusHighlight: true,
			SchoolName:        "北京大学",
			CanteenName:       "学一食堂",
			Floor:             "一层",
			WindowName:        "低脂窗口",
			TotalCalories:     480,
			TotalProtein:      35,
			Items:             preciseCampusItemsForServiceTest(),
			Price:             19,
			PublishedAt:       &now,
			CreatedAt:         &now,
		},
	}
	require.NoError(t, db.Create(&rows).Error)

	detail, err := svc.GetCampusDetail(ctx, "viewer-1", "campus-1")

	require.NoError(t, err)
	require.NotNil(t, detail)
	require.Equal(t, "campus-1", detail.Item.ID)
	require.Equal(t, "贡献者", detail.Item.Author.Nickname)
	require.Equal(t, 2.4, detail.Metrics.ProteinPerYuan)
	require.Equal(t, 3.81, detail.Metrics.PricePer100Kcal)
	require.Len(t, detail.SimilarItems, 1)
	require.Equal(t, "campus-2", detail.SimilarItems[0].ID)
	require.Len(t, detail.RelatedFeeds, 1)
	require.Equal(t, "campus-2", detail.RelatedFeeds[0].ID)
}

func preciseCampusItemsForServiceTest() []map[string]any {
	return []map[string]any{{
		"name":                   "测试菜品",
		"micronutrient_analysis": "ai_precise_v1",
		"micronutrient_source":   "qwen_generated",
		"nutrients": map[string]any{
			"fiber": 3.2, "sugar": 2.1, "saturatedFat": 1.2, "cholesterolMg": 15.0,
			"sodiumMg": 330.0, "potassiumMg": 460.0, "calciumMg": 120.0, "ironMg": 2.4,
			"magnesiumMg": 38.0, "zincMg": 2.1, "vitaminARaeMcg": 80.0, "vitaminCMg": 12.0,
			"vitaminDMcg": 1.0, "vitaminEMg": 1.5, "vitaminKMcg": 18.0, "thiaminMg": 0.2,
			"riboflavinMg": 0.2, "niacinMg": 3.1, "vitaminB6Mg": 0.3, "folateMcg": 45.0,
			"vitaminB12Mcg": 0.8,
		},
	}}
}

func TestHasPreciseCampusMicronutrients(t *testing.T) {
	require.False(t, hasPreciseCampusMicronutrients(nil))
	require.False(t, hasPreciseCampusMicronutrients(&domain.PublicFoodItem{}))
	require.False(t, hasPreciseCampusMicronutrients(&domain.PublicFoodItem{
		Items: []map[string]any{{"name": "普通分析菜品"}},
	}))
	require.False(t, hasPreciseCampusMicronutrients(&domain.PublicFoodItem{
		Items: []map[string]any{{
			"name":                   "字段不完整菜品",
			"micronutrient_analysis": "ai_precise_v1",
			"micronutrient_source":   "qwen_generated",
			"nutrients":              map[string]any{"calciumMg": 120.0},
		}},
	}))
	require.True(t, hasPreciseCampusMicronutrients(&domain.PublicFoodItem{
		Items: preciseCampusItemsForServiceTest(),
	}))
}

func TestPublicFoodServiceUpdateOwnItem(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	allowCampusPublishing(svc)
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&authrepo.User{ID: "user-1", Nickname: "作者"}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:           "item-1",
		UserID:       "user-1",
		FoodName:     "原菜品",
		Status:       "published",
		IsCampusFood: true,
		SchoolName:   "北京大学",
		CanteenName:  "学一食堂",
		Price:        15,
		PublishedAt:  &now,
		CreatedAt:    &now,
	}).Error)

	newName := "修改后的菜品"
	newSchool := "清华大学"
	newCanteen := "清芬园"
	newPrice := 18.0
	newPriceType := "fixed"
	newDesc := "修改后的描述"

	err := svc.Update(ctx, "user-1", "item-1", CreateInput{
		IsCampusFood: true,
		FoodName:     &newName,
		SchoolName:   &newSchool,
		CanteenName:  &newCanteen,
		Price:        &newPrice,
		PriceType:    &newPriceType,
		Description:  &newDesc,
	})
	require.NoError(t, err)

	var updated domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", "item-1").First(&updated).Error)
	require.Equal(t, "修改后的菜品", updated.FoodName)
	require.Equal(t, "清华大学", updated.SchoolName)
	require.Equal(t, "清芬园", updated.CanteenName)
	require.Equal(t, 18.0, updated.Price)
	require.Equal(t, "fixed", updated.PriceType)
	require.Equal(t, "修改后的描述", updated.Description)
	require.Equal(t, "清华大学 · 清芬园", updated.CampusLocationText)
}

func TestPublicFoodServiceUpdateNotFound(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()

	newName := "新名字"
	err := svc.Update(ctx, "user-1", "nonexistent", CreateInput{FoodName: &newName})
	require.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestPublicFoodServiceUpdateForbidden(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:          "item-1",
		UserID:      "user-1",
		FoodName:    "原菜品",
		Status:      "published",
		PublishedAt: &now,
		CreatedAt:   &now,
	}).Error)

	newName := "恶意修改"
	err := svc.Update(ctx, "user-2", "item-1", CreateInput{FoodName: &newName})
	require.ErrorIs(t, err, commonerrors.ErrForbidden)
}

func TestPublicFoodServiceUpdateSoftDeletedReturnsNotFound(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:          "item-1",
		UserID:      "user-1",
		FoodName:    "原菜品",
		Status:      "user_deleted",
		PublishedAt: &now,
		CreatedAt:   &now,
	}).Error)

	newName := "恢复"
	err := svc.Update(ctx, "user-1", "item-1", CreateInput{FoodName: &newName})
	require.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestPublicFoodServiceAddCommentReturnsUserProfile(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&authrepo.User{ID: "user-1", Nickname: "评论者", Avatar: "avatar.jpg"}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:          "item-1",
		UserID:      "author-1",
		FoodName:    "测试菜品",
		Status:      "published",
		PublishedAt: &now,
		CreatedAt:   &now,
	}).Error)

	comment, err := svc.AddComment(ctx, "user-1", "item-1", CommentInput{Content: "非常不错"})

	require.NoError(t, err)
	require.NotNil(t, comment)
	require.Equal(t, "user-1", comment.UserID)
	require.Equal(t, "评论者", comment.Nickname)
	require.NotEmpty(t, comment.Avatar)
}

func TestPublicFoodServiceAddReplyDefaultsReplyToParentAuthor(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&authrepo.User{ID: "user-1", Nickname: "评论者"}).Error)
	require.NoError(t, db.Create(&authrepo.User{ID: "user-2", Nickname: "回复者"}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:          "item-1",
		UserID:      "author-1",
		FoodName:    "测试菜品",
		Status:      "published",
		PublishedAt: &now,
		CreatedAt:   &now,
	}).Error)
	parentID := "comment-parent"
	require.NoError(t, db.Create(&domain.PublicFoodComment{
		ID:            parentID,
		UserID:        "user-1",
		LibraryItemID: "item-1",
		Content:       "这个菜不错",
		CreatedAt:     &now,
	}).Error)

	reply, err := svc.AddComment(ctx, "user-2", "item-1", CommentInput{
		Content:         "确实不错",
		ParentCommentID: &parentID,
	})

	require.NoError(t, err)
	require.NotNil(t, reply.ParentCommentID)
	require.Equal(t, parentID, *reply.ParentCommentID)
	require.NotNil(t, reply.ReplyToUserID)
	require.Equal(t, "user-1", *reply.ReplyToUserID)
	require.Nil(t, reply.Rating)
}

func TestPublicFoodServiceDeleteCommentOnlyOwnComment(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, db.Create(&authrepo.User{ID: "user-1", Nickname: "评论者"}).Error)
	require.NoError(t, db.Create(&authrepo.User{ID: "user-2", Nickname: "其他人"}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:           "item-1",
		UserID:       "author-1",
		FoodName:     "测试菜品",
		Status:       "published",
		CommentCount: 1,
		PublishedAt:  &now,
		CreatedAt:    &now,
	}).Error)
	comment := &domain.PublicFoodComment{
		ID:            "comment-1",
		UserID:        "user-1",
		LibraryItemID: "item-1",
		Content:       "我的评论",
		CreatedAt:     &now,
	}
	require.NoError(t, db.Create(comment).Error)

	err := svc.DeleteComment(ctx, "user-2", "item-1", "comment-1")
	require.ErrorIs(t, err, commonerrors.ErrNotFound)

	err = svc.DeleteComment(ctx, "user-1", "item-1", "comment-1")
	require.NoError(t, err)

	var count int64
	require.NoError(t, db.Model(&domain.PublicFoodComment{}).Where("id = ?", "comment-1").Count(&count).Error)
	require.EqualValues(t, 0, count)

	var item domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", "item-1").First(&item).Error)
	require.Equal(t, 0, item.CommentCount)
}

func TestNormalizePublicFoodItemResolvesSchoolLogoURL(t *testing.T) {
	store := storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "http://cdn-food-images.coachlink.fit",
	})
	svc := NewPublicFoodService(nil, store)

	rawKey := "school-badges/4531174e-aaaa-bbbb-cccc-08055423be2187ee.png"
	item := svc.normalizePublicFoodItem(domain.PublicFoodItem{
		SchoolLogoURL: rawKey,
	})
	require.Equal(t, "http://cdn-food-images.coachlink.fit/school-badges/4531174e-aaaa-bbbb-cccc-08055423be2187ee.png", item.SchoolLogoURL)

	fullURL := "http://cdn-food-images.coachlink.fit/school-badges/4531174e-aaaa-bbbb-cccc-08055423be2187ee.png"
	item2 := svc.normalizePublicFoodItem(domain.PublicFoodItem{
		SchoolLogoURL: fullURL,
	})
	require.Equal(t, fullURL, item2.SchoolLogoURL)

	item3 := svc.normalizePublicFoodItem(domain.PublicFoodItem{
		SchoolLogoURL: "",
	})
	require.Equal(t, "", item3.SchoolLogoURL)
}

func TestResolveSchoolLogoURLEmptyStorage(t *testing.T) {
	svc := NewPublicFoodService(nil)
	require.Equal(t, "school-badges/key.png", svc.resolveSchoolLogoURL("school-badges/key.png"))
	require.Equal(t, "", svc.resolveSchoolLogoURL(""))
}
