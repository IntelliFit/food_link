import { applyEnergyEdit } from '../../src/utils/nutrition-edit'

const base = {
  calories: 211,
  protein: 3.8,
  carbs: 27,
  fat: 9.8,
  fiber: 2,
  sugar: 4,
  sodiumMg: 320,
  waterMl: 80,
}

describe('applyEnergyEdit', () => {
  it('scales macros when calories are corrected and preserves micros/water', () => {
    const next = applyEnergyEdit(base, 'calories', 142)
    expect(next).toMatchObject({
      calories: 142,
      protein: 2.6,
      carbs: 18.2,
      fat: 6.6,
      fiber: 2,
      sodiumMg: 320,
      waterMl: 80,
    })
  })

  it('recalculates calories when a macro is edited', () => {
    expect(applyEnergyEdit(base, 'protein', 10).calories).toBe(236.2)
  })
})
