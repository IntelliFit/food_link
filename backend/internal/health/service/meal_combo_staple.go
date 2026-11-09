package service

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"

	"food_link/backend/internal/nutritionagg"
)

// Collected merchant menus hold two or three dishes per shop, rarely the rice that a stir-fry
// is eaten with: of 171 merchants around 北京 AI原点社区 (2026-11-05) 86 had a meat dish and
// only 21 any staple. At a Chinese restaurant rice is ordered beside the dish, so such a dish
// becomes a meal with one bowl of rice, valued from the food composition table and said to
// be ordered separately. Barbecue, braised snacks, drinks, noodle shops and the like do not
// sell rice by the bowl and get none.

const mealAddedStapleSource = "added_staple"

var (
	mealRiceRestaurantPattern = regexp.MustCompile(`饭店|饭馆|酒楼|酒家|餐厅|菜馆|小馆|食府|家常菜|小炒|炒菜|川菜|湘菜|粤菜|鲁菜|徽菜|东北菜|本帮|土菜|农家菜|私房菜|盖饭|快餐|中餐|江西菜|赣菜|贵州菜|云南菜|闽菜|潮汕|新疆菜|西北菜|蒸菜`)
	mealNoRiceVenuePattern    = regexp.MustCompile(`烧烤|烤串|串串|卤|熟食|鸭脖|鸭头|鸭货|奶茶|咖啡|茶饮|甜品|烘焙|面包|蛋糕|冰淇淋|水果|炸鸡|汉堡|披萨|比萨|火锅|麻辣烫|冒菜|小吃|粥|面馆|拉面|米线|米粉|粉店|饺子|馄饨|包子|煎饼|饭团|豆浆|意式|意大利|西餐|牛排|轻食|沙拉|日料|寿司|法式|西班牙|墨西哥`)
	// A dish that is itself the starch (fried noodles, rice cake, salad, dumplings) is not eaten with rice.
	mealStarchyDishPattern = regexp.MustCompile(`粉|面|饭|饼|粿|糕|饺|包|馄饨|抄手|粥|沙拉|三明治|汉堡|披萨|薯`)
)

// mealGoesWithRice is true for a dish eaten with a bowl of rice: a meat or vegetable dish
// that is not itself the starch of the meal.
func mealGoesWithRice(c DietRecommendationCandidate) bool {
	return !mealStarchyDishPattern.MatchString(c.Title) && c.Carbs < 40
}

// One bowl (200 g) of steamed white rice: 116 kcal, 2.6 g protein, 0.3 g fat and 25.9 g
// carbohydrate per 100 g (中国食物成分表 2018, 米饭(蒸)); minerals and vitamins from the
// same table and USDA FoodData Central for cooked unenriched white rice.
func mealStandardRiceNutrients() nutritionagg.Vector {
	values := map[string]float64{
		"fiber": 0.6, "sodiumMg": 5, "potassiumMg": 70, "calciumMg": 14, "ironMg": 0.4, "magnesiumMg": 24, "zincMg": 1.0,
		"vitaminARaeMcg": 0, "vitaminCMg": 0, "vitaminDMcg": 0, "vitaminEMg": 0.1, "vitaminB12Mcg": 0, "folateDfeMcg": 6,
		"saturatedFat": 0.2, "freeSugar": 0,
	}
	out := nutritionagg.Vector{}
	for _, def := range nutritionagg.Definitions {
		out[def.Key] = nutritionagg.Amount{Value: values[def.Key], Unit: def.Unit, Status: "estimated", KnownItems: 1, TotalItems: 1}
	}
	return out
}

func mealIsAddedStaple(c DietRecommendationCandidate) bool {
	return c.Source == mealAddedStapleSource
}

// mealSellsRiceBeside is true for an ordinary Chinese restaurant: one address, no canteen,
// and a name that says it serves dishes eaten with rice.
func mealSellsRiceBeside(c DietRecommendationCandidate) bool {
	name := c.MerchantName
	return !c.IsCampusFood && c.CanteenName == "" && c.Address != "" && name != "" &&
		mealRiceRestaurantPattern.MatchString(name) && !mealNoRiceVenuePattern.MatchString(name)
}

// mealAddedRice is the bowl of rice ordered beside a dish at the same restaurant.
func mealAddedRice(beside DietRecommendationCandidate) DietRecommendationCandidate {
	digest := sha256.Sum256([]byte(mealComboPlaceKey(beside)))
	rice := DietRecommendationCandidate{
		Source: mealAddedStapleSource, SourceID: fmt.Sprintf("rice:%x", digest[:10]), Title: "米饭（店内另点，一碗）",
		Description: "按一碗约200克蒸米饭的标准营养估算，不是店内收录的菜；是否单卖米饭和价格以店内为准",
		Calories:    232, Protein: 5.2, Carbs: 51.8, Fat: 0.6, Nutrients: mealStandardRiceNutrients(),
		MerchantName: beside.MerchantName, Address: beside.Address, SchoolID: beside.SchoolID, SchoolName: beside.SchoolName,
		CampusID: beside.CampusID, DistanceKM: beside.DistanceKM, LocationLevel: beside.LocationLevel,
		Latitude: beside.Latitude, Longitude: beside.Longitude, AvailabilityStatus: beside.AvailabilityStatus,
		PortionDescription: "一碗约200克", NutritionBasis: "standard_reference", NutritionSourceCategory: "food_composition_table",
		UncertaintyLevel: "medium",
	}
	rice.Items = []DietRecommendationFoodItem{{Name: "米饭", Amount: "约200g", Source: rice.Source, SourceID: rice.SourceID}}
	return rice
}

// mealAddRiceToRestaurant gives a restaurant whose collected dishes include a meat dish but
// no staple the bowl of rice those dishes are eaten with.
func mealAddRiceToRestaurant(place *mealComboPlace) {
	if len(place.staples) > 0 || len(place.proteins) == 0 {
		return
	}
	for _, part := range append(append([]*mealComboPart{}, place.proteins...), place.vegetables...) {
		if !part.plain || part.special || !mealSellsRiceBeside(part.c) {
			return
		}
	}
	rice := mealAddedRice(place.proteins[0].c)
	place.staples = append(place.staples, &mealComboPart{c: rice, role: mealRoleStaple, plain: true, dish: "米饭"})
}

// mealHasAddedStaple says whether an assembled meal relies on rice ordered separately.
func mealHasAddedStaple(components []DietRecommendationCandidate) bool {
	for _, c := range components {
		if mealIsAddedStaple(c) {
			return true
		}
	}
	return false
}

// mealUnpricedPartAllowed: a dish without a collected price may join a meal when the user set
// no budget; the meal then says its price is unknown. Priced by weight, as a range or at the
// market price, it is never one serving.
func mealUnpricedPartAllowed(state *campusDietAgentRunState, c DietRecommendationCandidate) bool {
	if state.Constraints.MaxPrice != nil || c.Price > 0 {
		return false
	}
	switch c.PriceType {
	case "by_weight", "range", "market":
		return false
	}
	return !strings.ContainsAny(c.PriceUnit, "两斤克")
}
