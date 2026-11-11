import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { libraryItemToAnalyzeItem } from '../../src/utils/food-library-picker'
import { buildFoodRecordItemPayloadFromResultItem } from '../../src/utils/food-record-item-payload'
import { convertApiFoodItemsToNutritionItems } from '../../src/packageExtra/pages/result/result-item-converter'
import { buildCorrectionItemsPayload, buildCorrectionPreviousResultItems, hasCorrectionChanges } from '../../src/packageExtra/pages/result/correction-payload'
import { packagedCandidateMeasurement, resizeResultMeasurement, resultMeasurementAmountText, rewriteResultMeasurementNutrients, withResultMeasurement } from '../../src/packageExtra/pages/result/result-measurement'
import { ResultQuantityControl } from '../../src/packageExtra/pages/result/ResultQuantityControl'
import type { FoodItem, FoodRecordItemPayload, Nutrients } from '../../src/utils/api'

const nutrients: Nutrients = { calories: 160, protein: 6, carbs: 20, fat: 5, fiber: 1, sugar: 0, sodium_mg: 20 }
const countItem: FoodRecordItemPayload = {
  name: '自制点心', weight: 0, intake: 0, ratio: 100, manual_source: 'custom', manual_source_id: 'custom-food',
  nutrients,
  measurement: { amount: 2, unit: 'piece', basis_amount: 1, basis_unit: 'piece', nutrients_per_basis: { calories: 80, protein: 3, carbs: 10, fat: 2.5, fiber: 0.5, sodium_mg: 10 } },
}
const convertPicked = (item = countItem) => convertApiFoodItemsToNutritionItems([libraryItemToAnalyzeItem(item, 5)])[0]

it('keeps a picked per-piece food through conversion and saving without inventing grams', () => {
  const item = convertPicked()
  expect(item.measurement).toMatchObject({ amount: 2, unit: 'piece', basis_unit: 'piece' })
  expect(item).toMatchObject({ weight: 0, originalWeight: 0, grossWeight: 0, intake: 0, calorie: 160 })
  expect(item.unitNutritionPer100g).toBeUndefined()
  const saved = buildFoodRecordItemPayloadFromResultItem(item, item.nutrients)
  expect(saved).toMatchObject({ weight: 0, intake: 0, ratio: 100, measurement: { amount: 2, unit: 'piece' }, nutrients: { calories: 160 } })
})

it('adjusts quantity in native units and applies intake ratio independently', () => {
  const item = { ...convertPicked(), ratio: 50 }
  const resized = resizeResultMeasurement(item, 3)
  expect(resultMeasurementAmountText(resized)).toBe('3个')
  expect(resultMeasurementAmountText(resized, true)).toBe('1.5个')
  expect(resized.calorie).toBe(240)
  const saved = buildFoodRecordItemPayloadFromResultItem(resized, resized.nutrients)
  expect(saved).toMatchObject({ weight: 0, intake: 0, ratio: 50, measurement: { amount: 3, nutrients_per_basis: { calories: 80 } } })
})

it('uses volume label nutrition when picking milk and never falls back to 100g', () => {
  const item = convertPicked({ ...countItem, name: '牛奶', measurement: { amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 60, protein: 3, sodium_mg: 40 } } })
  expect(item.calorie).toBe(150)
  expect(item.weight).toBe(0)
  expect(item.nutrients.sodium_mg).toBe(100)
  const changed = resizeResultMeasurement(item, 300)
  expect(changed.calorie).toBe(180)
  expect(changed.nutrients.sodium_mg).toBe(120)
  expect(resultMeasurementAmountText(changed)).toBe('300ml')
})

it('keeps an explicit serving conversion and only records grams when known', () => {
  const item = convertPicked({ ...countItem, measurement: { amount: 1, unit: 'serving', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 60 }, unit_conversions: { serving: 250 } } })
  expect(item.calorie).toBe(150)
  expect(item.weight).toBe(0)
  const withKnownMass = withResultMeasurement(item, { ...item.measurement!, unit_conversions: { serving: 250, g: 0.5 } })
  expect(withKnownMass.weight).toBe(500)
  expect(withKnownMass.calorie).toBe(150)
})

it('writes manually edited total nutrition back to the original basis', () => {
  const item = convertPicked()
  const edited = rewriteResultMeasurementNutrients(item, { ...item.nutrients, calories: 180, protein: 8 })
  expect(edited.measurement?.nutrients_per_basis).toMatchObject({ calories: 90, protein: 4 })
  const saved = buildFoodRecordItemPayloadFromResultItem(edited, edited.nutrients)
  expect(saved.nutrients.calories).toBe(180)
  expect(resizeResultMeasurement(edited, 3).calorie).toBe(270)
})

it('preserves native quantity and identity in correction snapshots', () => {
  const original = convertPicked()
  const changed = resizeResultMeasurement(original, 3)
  expect(hasCorrectionChanges([changed], [original], '')).toBe(true)
  const previous = buildCorrectionPreviousResultItems([changed], item => item.nutrients)
  expect(previous[0]).toMatchObject({ estimatedWeightGrams: 0, measurement: { amount: 3, unit: 'piece' } })
  const corrections = buildCorrectionItemsPayload([changed], [original], item => item.nutrients)
  expect(corrections[0]).toMatchObject({ weight: 0, measurement: { amount: 3 }, weightEdited: true })
})

const candidate = { id: 'milk250', nutrition_basis_unit: '100ml', net_content_value: 250, net_content_unit: 'ml', net_weight_g: 250, unit_nutrition_per_100g: { calories: 60, protein: 3 } }
const photoItem: FoodItem = { name: '牛奶', estimatedWeightGrams: 250, originalWeightGrams: 250, nutrients, packaged_food_id: 'milk250', package_weight_source: 'packaged_food_library', package_weight_applied: true, packaged_candidates: [candidate] }

it('recovers declared volume from the actually applied photo packaging candidate', () => {
  const [item] = convertApiFoodItemsToNutritionItems([photoItem])
  expect(item).toMatchObject({ weight: 0, calorie: 150, packagedPending: false, measurement: { amount: 250, unit: 'ml' } })
})

it('does not reinterpret a visual/user gram estimate as ml and requires an explicit specification choice', () => {
  const [item] = convertApiFoodItemsToNutritionItems([{ ...photoItem, estimatedWeightGrams: 120, package_weight_source: 'user_context' }])
  expect(item.measurement).toBeUndefined()
  expect(item.packagedPending).toBe(true)
  const chosen = withResultMeasurement(item, packagedCandidateMeasurement(candidate))
  expect(chosen).toMatchObject({ calorie: 150, weight: 0, measurement: { amount: 250, unit: 'ml' } })
  expect(packagedCandidateMeasurement({ ...candidate, nutrition_basis_unit: '' })).toBeNull()
})

it('renders and adjusts the actual piece count through the quantity component', () => {
  function Harness() {
    const [item, setItem] = useState(convertPicked())
    return <>
      <ResultQuantityControl item={item} onAdjust={(delta) => setItem(current => resizeResultMeasurement(current, current.measurement!.amount + delta))} />
      <span>{item.calorie} kcal</span>
    </>
  }
  render(<Harness />)
  expect(screen.getByText('2个')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('增加自制点心份量'))
  expect(screen.getByText('2.5个')).toBeInTheDocument()
  expect(screen.getByText('200 kcal')).toBeInTheDocument()
  expect(screen.queryByText('100g')).not.toBeInTheDocument()
})
