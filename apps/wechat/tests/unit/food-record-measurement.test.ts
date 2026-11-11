import { buildFoodRecordItemPayloadFromResultItem } from '../../src/utils/food-record-item-payload'
import { foodRecordAmountText, recordMeasurementWithNutrients } from '../../src/utils/food-record-measurement'
import { libraryItemToAnalyzeItem } from '../../src/utils/food-library-picker'
import type { FoodMeasurement } from '../../src/utils/food-measure'

const milk: FoodMeasurement = {
  amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml',
  nutrients_per_basis: { calories: 60, protein: 3, carbs: 5, fat: 3, sodium_mg: 40 },
}
const totals = { calories: 150, protein: 7.5, carbs: 12.5, fat: 7.5, fiber: 0, sugar: 0, sodium_mg: 100 }

describe('food quantity in saved record snapshots', () => {
  it('preserves volume across picker, record payload and intake display without inventing mass', () => {
    const payload = buildFoodRecordItemPayloadFromResultItem({
      name: '牛奶', weight: 250, intake: 250, ratio: 50, measurement: milk,
      manual_source: 'custom', manual_source_id: 'milk-1',
    }, totals)
    expect(payload.weight).toBe(0)
    expect(payload.intake).toBe(0)
    expect(payload.measurement).toEqual(expect.objectContaining({ amount: 250, unit: 'ml', basis_unit: 'ml' }))
    expect(foodRecordAmountText(payload)).toBe('125ml')
    const picked = libraryItemToAnalyzeItem(payload, 1)
    expect(picked.measurement).toEqual(payload.measurement)
    expect(picked.estimatedWeightGrams).toBe(0)
    expect(milk.nutrients_per_basis.sodium_mg).toBe(40)
  })

  it('scales count intake while retaining only a genuinely known gram conversion', () => {
    const egg: FoodMeasurement = {
      amount: 2, unit: 'piece', basis_amount: 1, basis_unit: 'piece',
      nutrients_per_basis: { calories: 80, protein: 6, carbs: 1, fat: 6 },
      unit_conversions: { g: 1 / 55 },
    }
    const payload = buildFoodRecordItemPayloadFromResultItem({
      name: '鸡蛋', weight: 2, intake: 1, ratio: 50, measurement: egg,
    }, { calories: 160, protein: 12, carbs: 2, fat: 12, fiber: 0, sugar: 0 })
    expect(payload.weight).toBeCloseTo(110)
    expect(payload.intake).toBeCloseTo(55)
    expect(foodRecordAmountText(payload)).toBe('1个（约55g）')
    expect(foodRecordAmountText({ measurement: { ...egg, unit_conversions: {} }, ratio: 100 })).toBe('2个')
    expect(foodRecordAmountText({ measurement: egg, ratio: 0 })).toBe('0个（约0g）')
  })

  it('changes only the record copy of nutrient values and keeps the original basis', () => {
    const corrected = recordMeasurementWithNutrients(milk, { ...totals, calories: 180, sodium_mg: 125 })
    expect(corrected.basis_unit).toBe('ml')
    expect(corrected.basis_amount).toBe(100)
    expect(corrected.nutrients_per_basis.calories).toBe(72)
    expect(corrected.nutrients_per_basis.sodium_mg).toBe(50)
    expect(corrected.nutrients_per_basis.sodiumMg).toBe(50)
    expect(milk.nutrients_per_basis.calories).toBe(60)
    expect(milk.nutrients_per_basis.sodium_mg).toBe(40)
  })

  it('rejects an invalid unit snapshot instead of silently falling back to grams', () => {
    const invalid = { ...milk, unit: 'piece' as const }
    expect(foodRecordAmountText({ measurement: invalid })).toBe('份量待确认')
    expect(() => buildFoodRecordItemPayloadFromResultItem({
      name: '错误单位', weight: 100, intake: 100, ratio: 100, measurement: invalid,
    }, totals)).toThrow('换算')
    expect(foodRecordAmountText({ weight: 100, ratio: 50 })).toBe('50g')
  })
})
