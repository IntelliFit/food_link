/**
 * 结果页底栏的一句话纠正胶囊：「米饭只吃了一半」「例汤没喝」。
 * 只在本地改这一项的实际摄入比例（和滑条一样），不重新识别、不扣积分。
 */
export interface QuickCorrectionItem {
  id: number
  name: string
  /** 整份热量（不乘比例） */
  calorie: number
  /** 当前实际摄入比例 0–100 */
  ratio: number
}

export interface QuickCorrection {
  itemId: number
  ratio: number
  label: string
  /** 应用后提示的前半句，后面接「这餐少 X kcal」 */
  toast: string
}

const LIQUID_NAME = /汤|粥|饮|奶|茶|咖啡|果汁|可乐|雪碧|豆浆|酸奶|啤酒|水$/
const MAX_NAME_CHARS = 6
const MAX_CHIPS = 3

function shortName(name: string): string {
  const clean = String(name || '').trim()
  return clean.length > MAX_NAME_CHARS ? `${clean.slice(0, MAX_NAME_CHARS)}…` : clean
}

export function isLiquidFoodName(name: string): boolean {
  return LIQUID_NAME.test(String(name || ''))
}

/** 热量最高的几样排前面：改它们对这一餐影响最大。汤、饮品给「没喝」，其他给「只吃了一半」。 */
export function buildQuickCorrections(items: QuickCorrectionItem[], max = MAX_CHIPS): QuickCorrection[] {
  const ranked = items
    .filter(item => item.name && item.calorie > 0)
    .slice()
    .sort((a, b) => b.calorie - a.calorie)
  const chips: QuickCorrection[] = []
  for (const item of ranked) {
    if (chips.length >= max) break
    const name = shortName(item.name)
    if (isLiquidFoodName(item.name)) {
      if (item.ratio > 0) chips.push({ itemId: item.id, ratio: 0, label: `${name}没喝`, toast: `${name}去掉了` })
      continue
    }
    if (item.ratio > 50) chips.push({ itemId: item.id, ratio: 50, label: `${name}只吃了一半`, toast: `${name}按一半算` })
  }
  return chips
}

/** 改完比例后这一餐少了多少 kcal（取整，不会是负数） */
export function quickCorrectionSavedKcal(item: QuickCorrectionItem, nextRatio: number): number {
  return Math.max(0, Math.round((item.calorie * (item.ratio - nextRatio)) / 100))
}
