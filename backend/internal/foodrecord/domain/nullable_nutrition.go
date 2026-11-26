package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"

	"gorm.io/gorm/schema"
)

// NutritionFields is the ordinary-food column to API-unit-key contract.
// Keep unknown separate from a measured zero, including across legacy numeric callers.
var NutritionFields = map[string]string{
	"kcal_per_100g": "calories", "protein_per_100g": "protein", "carbs_per_100g": "carbs", "fat_per_100g": "fat",
	"fiber_per_100g": "fiber", "sugar_per_100g": "sugar", "saturated_fat_per_100g": "saturatedFat", "cholesterol_mg_per_100g": "cholesterolMg",
	"sodium_mg_per_100g": "sodiumMg", "potassium_mg_per_100g": "potassiumMg", "calcium_mg_per_100g": "calciumMg", "iron_mg_per_100g": "ironMg",
	"magnesium_mg_per_100g": "magnesiumMg", "zinc_mg_per_100g": "zincMg", "vitamin_a_rae_mcg_per_100g": "vitaminARaeMcg",
	"vitamin_c_mg_per_100g": "vitaminCMg", "vitamin_d_mcg_per_100g": "vitaminDMcg", "vitamin_e_mg_per_100g": "vitaminEMg", "vitamin_k_mcg_per_100g": "vitaminKMcg",
	"thiamin_mg_per_100g": "thiaminMg", "riboflavin_mg_per_100g": "riboflavinMg", "niacin_mg_per_100g": "niacinMg", "vitamin_b6_mg_per_100g": "vitaminB6Mg",
	"folate_mcg_per_100g": "folateMcg", "vitamin_b12_mcg_per_100g": "vitaminB12Mcg",
}

func init() { schema.RegisterSerializer("nullable_nutrition", nullableNutritionSerializer{}) }

type nullableNutritionSerializer struct{}

func nutritionObject(dst reflect.Value) *FoodNutrition {
	for dst.Kind() == reflect.Ptr {
		if dst.IsNil() {
			return nil
		}
		dst = dst.Elem()
	}
	if dst.CanAddr() {
		f, _ := dst.Addr().Interface().(*FoodNutrition)
		if f != nil {
			return f
		}
	}
	if dst.Kind() == reflect.Struct {
		if nested := dst.FieldByName("FoodNutrition"); nested.IsValid() {
			return nutritionObject(nested)
		}
	}
	return nil
}

func (nullableNutritionSerializer) Scan(ctx context.Context, field *schema.Field, dst reflect.Value, raw any) error {
	food := nutritionObject(dst)
	if food == nil {
		return fmt.Errorf("未知营养值映射目标错误")
	}
	if raw == nil {
		food.MarkNutritionUnknown(field.DBName)
		return field.Set(ctx, dst, float64(0))
	}
	var value float64
	switch v := raw.(type) {
	case float64:
		value = v
	case int64:
		value = float64(v)
	case []byte:
		n, e := strconv.ParseFloat(string(v), 64)
		if e != nil {
			return e
		}
		value = n
	case string:
		n, e := strconv.ParseFloat(v, 64)
		if e != nil {
			return e
		}
		value = n
	default:
		return fmt.Errorf("不支持的营养数值类型 %T", raw)
	}
	food.MarkNutritionKnown(field.DBName)
	return field.Set(ctx, dst, value)
}

func (nullableNutritionSerializer) Value(ctx context.Context, field *schema.Field, dst reflect.Value, value any) (any, error) {
	if food := nutritionObject(dst); food != nil && food.NutritionUnknown(field.DBName) {
		return nil, nil
	}
	return value, nil
}

func (f *FoodNutrition) NutritionUnknown(column string) bool {
	for _, c := range f.UnknownNutritionFields {
		if c == column {
			return true
		}
	}
	return false
}
func (f *FoodNutrition) MarkNutritionUnknown(column string) {
	if _, ok := NutritionFields[column]; ok && !f.NutritionUnknown(column) {
		f.UnknownNutritionFields = append(f.UnknownNutritionFields, column)
	}
}
func (f *FoodNutrition) MarkNutritionKnown(column string) {
	out := f.UnknownNutritionFields[:0]
	for _, c := range f.UnknownNutritionFields {
		if c != column {
			out = append(out, c)
		}
	}
	f.UnknownNutritionFields = out
}

// MarshalJSON overrides only the unknown numeric fields. A verified zero stays 0.
func (f FoodNutrition) MarshalJSON() ([]byte, error) {
	type plain FoodNutrition
	body, err := json.Marshal(plain(f))
	if err != nil {
		return nil, err
	}
	var obj map[string]json.RawMessage
	if err = json.Unmarshal(body, &obj); err != nil {
		return nil, err
	}
	for _, column := range f.UnknownNutritionFields {
		if _, ok := NutritionFields[column]; ok {
			obj[column] = json.RawMessage("null")
		}
	}
	return json.Marshal(obj)
}

func (f *FoodNutrition) UnitNutritionPer100g() map[string]any {
	unit := map[string]any{
		"calories": f.KcalPer100g, "protein": f.ProteinPer100g, "carbs": f.CarbsPer100g, "fat": f.FatPer100g,
		"fiber": f.FiberPer100g, "sugar": f.SugarPer100g, "saturatedFat": f.SaturatedFatPer100g, "cholesterolMg": f.CholesterolMgPer100g,
		"sodiumMg": f.SodiumMgPer100g, "potassiumMg": f.PotassiumMgPer100g, "calciumMg": f.CalciumMgPer100g, "ironMg": f.IronMgPer100g,
		"magnesiumMg": f.MagnesiumMgPer100g, "zincMg": f.ZincMgPer100g, "vitaminARaeMcg": f.VitaminARaeMcgPer100g,
		"vitaminCMg": f.VitaminCMgPer100g, "vitaminDMcg": f.VitaminDMcgPer100g, "vitaminEMg": f.VitaminEMgPer100g, "vitaminKMcg": f.VitaminKMcgPer100g,
		"thiaminMg": f.ThiaminMgPer100g, "riboflavinMg": f.RiboflavinMgPer100g, "niacinMg": f.NiacinMgPer100g, "vitaminB6Mg": f.VitaminB6MgPer100g,
		"folateMcg": f.FolateMcgPer100g, "vitaminB12Mcg": f.VitaminB12McgPer100g,
	}
	for _, column := range f.UnknownNutritionFields {
		if key, ok := NutritionFields[column]; ok {
			unit[key] = nil
		}
	}
	return unit
}
