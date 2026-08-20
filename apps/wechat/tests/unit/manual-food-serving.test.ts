import {
  manualFoodDisplayInput,
  manualFoodResultPortionText,
  manualFoodWeightInputUnit,
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

  it('edits piece-based foods by grams while retaining the piece equivalent', () => {
    const eggWhite = {
      weight: 33,
      defaultWeight: 33,
      displayUnit: 'piece' as const,
      displayUnitLabel: '个',
    }
    expect(manualFoodDisplayInput(eggWhite)).toBe('33')
    expect(manualFoodWeightFromInput(eggWhite, 66)).toBe(66)
    expect(manualFoodWeightInputUnit(eggWhite)).toBe('g')
    expect(selectedManualFoodAmountText(eggWhite)).toBe('1个（约33g）')
  })

  it('continues to edit serving-based foods by serving count', () => {
    const meal = {
      weight: 300,
      defaultWeight: 200,
      displayUnit: 'serving' as const,
      displayUnitLabel: '份',
    }
    expect(manualFoodDisplayInput(meal)).toBe('1.5')
    expect(manualFoodWeightFromInput(meal, 2)).toBe(400)
    expect(manualFoodWeightInputUnit(meal)).toBe('份')
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
})
