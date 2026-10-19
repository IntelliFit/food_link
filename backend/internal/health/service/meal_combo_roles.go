package service

import (
	"regexp"
	"strings"
)

// mealComboRole is a menu-name heuristic used to assemble meals from a canteen's
// single dishes. It is not a nutrient measurement: every assembled meal is still
// validated by the structure, ordering and nutrition rules before it is offered.
type mealComboRole string

const (
	mealRoleStaple    mealComboRole = "staple"
	mealRoleProtein   mealComboRole = "protein"
	mealRoleVegetable mealComboRole = "vegetable"
	mealRoleSoup      mealComboRole = "soup"
	mealRoleDrink     mealComboRole = "drink"
	mealRoleFull      mealComboRole = "full"
	mealRoleOther     mealComboRole = "other"
)

var (
	// Snacks, desserts, sharing platters, pizza and sweet drinks are never a side
	// of a canteen meal, whatever protein or vegetable word their name contains.
	mealSnackDrinkPattern = regexp.MustCompile(`奶茶|可乐|雪碧|汽水|果汁|饮料|咖啡|茶饮|柠檬茶|气泡|冰淇淋|冰激凌|雪糕|冰沙|奶昔|蛋糕|甜品|布丁|糖水|披萨|比萨|薯条|薯片|薯格|薯塔|薯角|洋葱圈|热狗|圣代|甘露|西米露|红豆沙|糍粑|麻薯|黑森林|红丝绒|泡芙|蛋挞|曲奇|巧克力|梦龙|大满贯|拼盘|银耳|雪梨|米糕|香蕉王|汁$`)
	mealPlainDrinkPattern = regexp.MustCompile(`豆浆|豆奶|牛奶|纯奶|酸奶|鲜奶|燕麦奶`)
	mealSoupNamePattern   = regexp.MustCompile(`[汤羹]\s*$`)
	// Rice, noodle, porridge, bun and pancake dishes by what the name ends with or
	// plainly says. A topped bowl is already caught as a whole meal before this.
	mealStapleNamePattern    = regexp.MustCompile(`米饭|白饭|糙米|杂粮饭|五谷饭|饭$|饭（|馒头|花卷|包子|烧饼|饼$|炒饼|饼丝|面$|面（|粉$|粥$|面条|面包|吐司|饭团|蒸红薯|烤红薯|蒸玉米|煮玉米|^玉米$|^红薯$|^地瓜$|^紫薯$|^山药$|水饺|蒸饺|馄饨|抄手|米线|米粉|河粉|凉皮|年糕`)
	mealProteinNamePattern   = regexp.MustCompile(`肉|鸡|牛|猪|鱼|虾|蛋|豆腐|豆皮|豆干|腐竹|排骨|鸭|羊|鹅|蟹|贝|鱿|蚝|培根|火腿|香肠|丸|里脊|五花|猪蹄|肘子|翅|腿|柳`)
	mealVegetableNamePattern = regexp.MustCompile(`菜|蔬|瓜|菇|菌|笋|芹|菠|茄|萝卜|西兰花|花菜|豆角|四季豆|木耳|海带|紫菜|洋葱|青椒|彩椒|土豆丝|凉拌`)
	// "可乐鸡翅" is a meat dish cooked with cola, not a drink.
	mealFlavouredProtein = regexp.MustCompile(`(?:可乐|咖啡|啤酒|红酒)(?:鸡|排骨|翅|牛|猪|鸭|鱼)`)
	// Names that contain a meat word without containing meat: 鱼香茄子, 鸡毛菜, 贝贝南瓜, 牛油果.
	mealProteinFalseFriends = regexp.MustCompile(`鱼香|鸡毛菜|贝贝南瓜|牛油果|蟹味菇|鸡腿菇|鸡枞|牛肝菌|猪肝菌|猴头菇`)
	// A window called 素菜 sells vegetable dishes even when a dish name does not say so.
	mealVegetableWindowPattern = regexp.MustCompile(`素菜|蔬菜|时蔬`)
)

func mealComboRoleOf(c DietRecommendationCandidate) mealComboRole {
	title := strings.TrimSpace(c.Title)
	switch {
	case mealSnackDrinkPattern.MatchString(title) && !mealFlavouredProtein.MatchString(title):
		return mealRoleOther
	case mealPlainDrinkPattern.MatchString(title):
		return mealRoleDrink
	case mealSoupNamePattern.MatchString(title):
		return mealRoleSoup
	case mealHasStructure(c):
		return mealRoleFull
	case mealStapleNamePattern.MatchString(title):
		return mealRoleStaple
	case mealProteinNamePattern.MatchString(mealProteinFalseFriends.ReplaceAllString(title, "")):
		return mealRoleProtein
	case mealVegetableNamePattern.MatchString(title), mealVegetableWindowPattern.MatchString(c.WindowName) && c.Protein < 10:
		return mealRoleVegetable
	}
	return mealRoleOther
}

func mealComboRoleLabel(role mealComboRole) string {
	switch role {
	case mealRoleStaple:
		return "主食"
	case mealRoleProtein:
		return "荤菜"
	case mealRoleVegetable:
		return "蔬菜"
	case mealRoleSoup:
		return "汤"
	case mealRoleDrink:
		return "饮品"
	case mealRoleFull:
		return "整份主餐"
	}
	return "其他"
}

var mealSpecialVenuePattern = regexp.MustCompile(`(?i)披萨|比萨|pizza|火锅|涮|麻辣烫|冒菜|串串|烧烤|烤串|烤肉|饮品|奶茶|咖啡|茶饮|甜品|烘焙|面包房|蛋糕|冰淇淋|水果`)

// A stall that sells its own kind of food (pizza, hot pot, grill, drinks, dessert)
// is not a place to pick a side dish for someone else's meal.
func mealSpecialVenue(c DietRecommendationCandidate) bool {
	return mealSpecialVenuePattern.MatchString(c.WindowName + " " + c.MerchantName)
}
