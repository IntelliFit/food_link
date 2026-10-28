import type { MealDishItem, MealDishView } from '../../utils/meal-dish-api'

/** 等待页卡片的步骤：首页推荐过的菜先一键确认，再问食堂、哪道菜；缺实拍才问照片，积极用户可能再问价格。 */
export type MealDishStep = 'offer' | 'recommended' | 'canteen' | 'dish' | 'photo' | 'price' | 'done' | 'hidden'

export function stepOf(view: MealDishView | null, offerLocation: boolean, recommendDismissed = false): MealDishStep {
  if (!view) return 'hidden'
  if (!view.eligible) return offerLocation ? 'offer' : 'hidden'
  const prompt = view.prompt
  if (prompt?.skipped_at) return 'hidden'
  if (prompt?.chosen_item_id) {
    const photoPending = prompt.gap_kind === 'photo' && prompt.photo_consent === undefined && !prompt.photo_contributed_at
    if (photoPending) return 'photo'
    if (view.price_ask && prompt.price_asked_at && !prompt.price_answer_kind) return 'price'
    return 'done'
  }
  if (prompt?.chosen_canteen_id) return 'dish'
  if (view.recommended_dish && !recommendDismissed) return 'recommended'
  return 'canteen'
}

/** 用户已经在答题（选了食堂还没选菜，或在决定照片、价格），识别完成时稍等一下再跳转。 */
export function isAnswering(step: MealDishStep): boolean {
  return step === 'dish' || step === 'photo' || step === 'price'
}

export const DISH_PREVIEW_COUNT = 4

/** 当前窗口的菜：默认显示前 4 道，展开后最多 12 道。 */
export function dishesForWindow(dishes: MealDishItem[], windowName: string, expanded: boolean): MealDishItem[] {
  const inWindow = dishes.filter(dish => (dish.window_name || '其他窗口') === windowName)
  return inWindow.slice(0, expanded ? 12 : DISH_PREVIEW_COUNT)
}

export function chosenSummary(view: MealDishView | null): string {
  if (!view?.chosen_dish) return ''
  const parts = [view.chosen_canteen?.name, view.chosen_dish.window_name, view.chosen_dish.name].filter(Boolean)
  return parts.join(' · ') + (view.chosen_dish.price_text ? ` · ${view.chosen_dish.price_text}` : '')
}

/** 推荐理由文字缺失时的兜底（已存在的提示重新打开时没有距离等信息）。 */
export function canteenHint(reasonText: string, dishCount: number): string {
  if (reasonText) return reasonText
  return dishCount > 0 ? `${dishCount} 道菜` : ''
}

/** 价格输入：只接受 0–500 元、最多两位小数；不合法返回 null。 */
export function parsePriceInput(text: string): number | null {
  const value = Number(String(text || '').trim())
  if (!Number.isFinite(value) || value <= 0 || value > 500) return null
  return Math.round(value * 100) / 100
}
