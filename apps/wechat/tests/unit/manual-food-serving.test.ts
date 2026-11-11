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

  it('edits native piece quantities directly without inventing grams', () => {
    const item = { weight: 2, defaultWeight: 1, displayUnit: 'piece' as const, displayUnitLabel: '个', measurement: { amount: 1, unit: 'piece' as const, basis_amount: 1, basis_unit: 'piece' as const, nutrients_per_basis: { calories: 80 } } }
    expect(manualFoodDisplayInput(item)).toBe('2')
    expect(manualFoodWeightInputUnit(item)).toBe('个')
    expect(manualFoodWeightFromInput(item, 3)).toBe(3)
    expect(selectedManualFoodAmountText(item)).toBe('2个')
    expect(manualFoodResultPortionText({ measurement: item.measurement, default_weight_grams: 0 })).toBe('1个')
  })

  it.each([['piece', 0.25], ['g', 12.55]] as const)('preserves the unedited %s quantity %s in the input submitted on save', (unit, amount) => {
    const item = {
      weight: amount, defaultWeight: amount, displayUnit: unit, displayUnitLabel: unit,
      measurement: { amount, unit, basis_amount: 1, basis_unit: unit, nutrients_per_basis: { calories: 80 } },
    }
    const input = manualFoodDisplayInput(item)
    expect(manualFoodWeightFromInput(item, Number(input))).toBe(amount)
  })
})
