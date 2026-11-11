import {
  convertFoodAmount, foodMeasurementAllowedUnits, foodMeasurementGrams,
  foodMeasurementPer100g, formatFoodMeasurementBasis, normalizeFoodMeasurement,
  scaleFoodMeasurementNutrients, validateFoodMeasurement, type FoodMeasurement,
} from '../../src/utils/food-measure'

const milk: FoodMeasurement = {
  amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 60, protein: 3 },
}

describe('food measurement', () => {
  it('scales a 250ml drink directly against its 100ml label without inventing mass', () => {
    expect(scaleFoodMeasurementNutrients(milk)).toEqual({ calories: 150, protein: 7.5 })
    expect(foodMeasurementGrams(milk)).toBeNull()
    expect(foodMeasurementPer100g(milk)).toBeNull()
    expect(foodMeasurementAllowedUnits(milk)).toEqual(['ml'])
    expect(formatFoodMeasurementBasis(milk)).toBe('每100ml')
  })

  it('scales two pieces from a per-piece label without requiring grams', () => {
    const food: FoodMeasurement = { amount: 2, unit: 'piece', basis_amount: 1, basis_unit: 'piece', nutrients_per_basis: { calories: 80 } }
    expect(scaleFoodMeasurementNutrients(food)?.calories).toBe(160)
    expect(foodMeasurementGrams(food)).toBeNull()
  })

  it('uses an explicit 150g serving relationship', () => {
    const food: FoodMeasurement = { amount: 1, unit: 'serving', basis_amount: 100, basis_unit: 'g', nutrients_per_basis: { calories: 200 }, unit_conversions: { serving: 150 } }
    expect(scaleFoodMeasurementNutrients(food)?.calories).toBe(300)
    expect(foodMeasurementGrams(food)).toBe(150)
    expect(convertFoodAmount(food, 300, 'g', 'serving')).toBe(2)
  })

  it('rejects an undefined cross-unit relationship and never assumes ml equals g', () => {
    expect(convertFoodAmount(milk, 100, 'ml', 'g')).toBeNull()
    expect(scaleFoodMeasurementNutrients({ ...milk, unit: 'piece' })).toBeNull()
    expect(normalizeFoodMeasurement({ ...milk, unit: 'serving' })).toBeNull()
  })

  it('can derive mass only when its relationship is explicitly supplied', () => {
    const knownMass = { ...milk, unit_conversions: { g: 0.8 } }
    expect(foodMeasurementGrams(knownMass)).toBe(312.5)
    expect(foodMeasurementPer100g(knownMass)?.calories).toBe(48)
  })

  it('rejects numeric overflow instead of emitting infinite nutrition or mass', () => {
    expect(convertFoodAmount({ ...milk, amount: Number.MAX_VALUE, unit_conversions: { g: Number.MIN_VALUE } }, Number.MAX_VALUE, 'ml', 'g')).toBeNull()
    expect(scaleFoodMeasurementNutrients({ ...milk, amount: Number.MAX_VALUE })).toBeNull()
  })

  it.each([
    { ...milk, amount: 0 }, { ...milk, basis_amount: -1 },
    { ...milk, amount: Infinity }, { ...milk, nutrients_per_basis: { calories: NaN } },
    { ...milk, nutrients_per_basis: { calories: -10 } }, { ...milk, unit_conversions: { ml: 2 } },
  ])('rejects invalid measurements %#', (food) => {
    expect(validateFoodMeasurement(food)).not.toBeNull()
  })
})
