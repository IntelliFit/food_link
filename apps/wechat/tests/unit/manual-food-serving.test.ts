import {
  manualFoodDetailPortionNutrients,
  manualFoodDisplayInput,
  manualFoodResultPortionText,
  manualFoodWeightFromInput,
  practicalManualFoodDefaultWeight,
  selectedManualFoodAmountText,
} from '../../src/utils/manual-food-serving'

describe('manual-food-serving', () => {
  it('always exposes gram equivalents for piece-based foods', () => {
    expect(manualFoodResultPortionText({
      source: 'nutrition_library',
      default_weight_grams: 55,
      display_unit: 'piece',
      display_unit_label: '个',
    })).toBe('1个（约55g）')
    expect(selectedManualFoodAmountText({
      weight: 55,
      defaultWeight: 55,
      displayUnit: 'piece',
      displayUnitLabel: '个',
    })).toBe('1个（约55g）')
  })

  it('uses each food default weight instead of a hard-coded 55g piece', () => {
    const eggWhite = {
      weight: 33,
      defaultWeight: 33,
      displayUnit: 'piece' as const,
      displayUnitLabel: '个',
    }
    expect(manualFoodDisplayInput(eggWhite)).toBe('1')
    expect(manualFoodWeightFromInput(eggWhite, 2)).toBe(66)
    expect(selectedManualFoodAmountText(eggWhite)).toBe('1个（约33g）')
  })

  it('rounds historical nutrition-library averages to practical whole grams', () => {
    expect(practicalManualFoodDefaultWeight({
      source: 'nutrition_library',
      default_weight_grams: 65.8333333333,
      display_unit: 'g',
    })).toBe(66)
    expect(manualFoodResultPortionText({
      source: 'nutrition_library',
      default_weight_grams: 65.8333333333,
      display_unit: 'g',
      display_unit_label: 'g',
    })).toBe('66g')
  })

  it('keeps explicit packaged decimal serving weights', () => {
    expect(practicalManualFoodDefaultWeight({
      source: 'packaged_food',
      default_weight_grams: 12.5,
      display_unit: 'g',
    })).toBe(12.5)
  })

  it('scales all detail micronutrients from per-100g data to the displayed portion', () => {
    const nutrients = manualFoodDetailPortionNutrients({
      source: 'nutrition_library',
      default_weight_grams: 55,
      total_calories: 80,
      total_protein: 6.8,
      total_carbs: 0.6,
      total_fat: 5.3,
      nutrients_per_100g: {
        calories: 145,
        protein: 12.4,
        carbs: 1.1,
        fat: 9.6,
        fiber: 0,
        sugar: 0.4,
        calciumMg: 50,
        ironMg: 2,
        vitaminDMcg: 2,
      },
      extra_nutrients: {
        fiber: 0,
        sugar: 0.4,
        calciumMg: 50,
        ironMg: 2,
        vitaminDMcg: 2,
      },
    })

    expect(nutrients.calciumMg).toBe(27.5)
    expect(nutrients.ironMg).toBe(1.1)
    expect(nutrients.vitaminDMcg).toBe(1.1)
    expect(nutrients.protein).toBe(6.8)
  })

  it('uses per-100g micronutrients for custom portions instead of treating them as totals', () => {
    const nutrients = manualFoodDetailPortionNutrients({
      source: 'custom',
      default_weight_grams: 200,
      total_calories: 240,
      total_protein: 20,
      total_carbs: 30,
      total_fat: 4,
      nutrients_per_100g: {
        calories: 120,
        protein: 10,
        carbs: 15,
        fat: 2,
        fiber: 3,
        sugar: 1,
        ironMg: 5,
      },
      extra_nutrients: { fiber: 3, sugar: 1, ironMg: 5 },
    })

    expect(nutrients.fiber).toBe(6)
    expect(nutrients.ironMg).toBe(10)
    expect(nutrients.calories).toBe(240)
  })
})
