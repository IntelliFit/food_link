import type { NutritionFocusChoice } from '../../utils/api'
import { builtinFocusLabel } from '../../components/FocusSheet/focus-options'

/** 「我在意的」那一行显示的名字：内置项用短名（控血压），自定义的用用户写的 */
export function petFocusLabels(current: readonly NutritionFocusChoice[]): string[] {
  return current
    .map((item) => (item.custom ? item.title : builtinFocusLabel(item.key) || item.title))
    .filter((label): label is string => Boolean(label))
}
