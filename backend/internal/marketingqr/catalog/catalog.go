package catalog

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const TakeoutCode = "takeout"

//go:embed sanshengxiao.json
var sanshengxiaoJSON []byte

type Nutrition struct {
	CaloriesKcal float64 `json:"calories_kcal"`
	ProteinG     float64 `json:"protein_g"`
	CarbsG       float64 `json:"carbs_g"`
	FatG         float64 `json:"fat_g"`
}

type Product struct {
	Code               string    `json:"code"`
	ExternalID         string    `json:"external_id"`
	Name               string    `json:"name"`
	SourceCategory     string    `json:"source_category"`
	Category           string    `json:"category"`
	SpecSource         string    `json:"spec_source"`
	PortionDescription string    `json:"portion_description"`
	PriceMin           float64   `json:"price_min"`
	PriceMax           float64   `json:"price_max"`
	StockSnapshot      int       `json:"stock_snapshot"`
	SalesSnapshot      int       `json:"sales_snapshot"`
	Channel            string    `json:"channel"`
	ImageKey           string    `json:"image_key"`
	Nutrition          Nutrition `json:"nutrition"`
}

type Dataset struct {
	Version             string    `json:"version"`
	MerchantName        string    `json:"merchant_name"`
	BranchName          string    `json:"branch_name"`
	SchoolName          string    `json:"school_name"`
	Address             string    `json:"address"`
	Latitude            float64   `json:"latitude"`
	Longitude           float64   `json:"longitude"`
	LocationIsEstimated bool      `json:"location_is_estimated"`
	NutritionNotice     string    `json:"nutrition_notice"`
	Products            []Product `json:"products"`
}

var (
	dataset      Dataset
	productsByID map[string]Product
)

func init() {
	if err := json.Unmarshal(sanshengxiaoJSON, &dataset); err != nil {
		panic(fmt.Sprintf("解析三生晓二维码商品清单失败: %v", err))
	}
	productsByID = make(map[string]Product, len(dataset.Products))
	for _, product := range dataset.Products {
		code := NormalizeCode(product.Code)
		if code == "" {
			panic("三生晓二维码商品清单存在空短码")
		}
		if _, exists := productsByID[code]; exists {
			panic("三生晓二维码商品清单存在重复短码: " + code)
		}
		product.Code = code
		productsByID[code] = product
	}
}

func NormalizeCode(code string) string {
	return strings.ToLower(strings.TrimSpace(code))
}

func DatasetSnapshot() Dataset {
	copyDataset := dataset
	copyDataset.Products = append([]Product(nil), dataset.Products...)
	return copyDataset
}

func ProductByCode(code string) (Product, bool) {
	product, ok := productsByID[NormalizeCode(code)]
	return product, ok
}

func IsKnownCode(code string) bool {
	code = NormalizeCode(code)
	if code == TakeoutCode {
		return true
	}
	_, ok := productsByID[code]
	return ok
}

func Codes() []string {
	codes := make([]string, 0, len(productsByID)+1)
	for code := range productsByID {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return append(codes, TakeoutCode)
}
