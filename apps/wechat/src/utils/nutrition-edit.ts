import type { Nutrients } from './api'
import { roundTo } from './number-format'

export type EditableMacroField = 'protein' | 'carbs' | 'fat'

const safe = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const caloriesFromMacros = (protein: number, carbs: number, fat: number): number => (
  roundTo(safe(protein) * 4 + safe(carbs) * 4 + safe(fat) * 9, 1)
)

/**
 * Keeps the four user-editable energy fields internally consistent.
 * Calories scale all macros proportionally; a macro edit recalculates calories.
 * Micronutrients and water are deliberately preserved.
 */
export function applyEnergyEdit(
  nutrients: Nutrients,
  field: 'calories' | EditableMacroField,
  nextValue: number,
): Nutrients {
  const normalized = Math.max(0, roundTo(Number.isFinite(nextValue) ? nextValue : 0, 1))
  const currentCalories = safe(nutrients.calories) || caloriesFromMacros(
    safe(nutrients.protein),
    safe(nutrients.carbs),
    safe(nutrients.fat),
  )

  if (field === 'calories') {
    const factor = currentCalories > 0 ? normalized / currentCalories : 0
    return {
      ...nutrients,
      calories: normalized,
      protein: roundTo(safe(nutrients.protein) * factor, 1),
      carbs: roundTo(safe(nutrients.carbs) * factor, 1),
      fat: roundTo(safe(nutrients.fat) * factor, 1),
    }
  }

  const next = {
    ...nutrients,
    [field]: normalized,
  }
  return {
    ...next,
    calories: caloriesFromMacros(next.protein, next.carbs, next.fat),
  }
}
