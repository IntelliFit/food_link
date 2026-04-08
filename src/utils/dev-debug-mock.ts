/**
 * 调试用随机 AnalyzeResponse，与正式接口结构一致，供结果页 / 记录详情预览等复用。
 */
import type { AnalyzeResponse, FoodItem } from './api'

export function buildRandomDebugAnalyzeResponse(): AnalyzeResponse {
  const round1 = (n: number) => Math.round(n * 10) / 10
  const rnd = (min: number, max: number) => min + Math.random() * (max - min)
  const kcalFromMacros = (p: number, c: number, f: number) =>
    Math.round(round1(p) * 4 + round1(c) * 4 + round1(f) * 9)

  const w1 = Math.round(rnd(140, 320))
  const w2 = Math.round(rnd(90, 240))
  const p1 = round1(rnd(6, 32))
  const c1 = round1(rnd(12, 58))
  const f1 = round1(rnd(4, 26))
  const p2 = round1(rnd(2, 16))
  const c2 = round1(rnd(4, 32))
  const f2 = round1(rnd(1, 12))
  const cal1 = kcalFromMacros(p1, c1, f1)
  const cal2 = kcalFromMacros(p2, c2, f2)

  const items: FoodItem[] = [
    {
      itemId: 1,
      name: '调试 · 咖喱鸡饭',
      estimatedWeightGrams: w1,
      originalWeightGrams: w1,
      nutrients: {
        calories: cal1,
        protein: p1,
        carbs: c1,
        fat: f1,
        fiber: round1(rnd(1, 7)),
        sugar: round1(rnd(0, 14))
      }
    },
    {
      itemId: 2,
      name: '调试 · 蔬菜沙拉',
      estimatedWeightGrams: w2,
      originalWeightGrams: w2,
      nutrients: {
        calories: cal2,
        protein: p2,
        carbs: c2,
        fat: f2,
        fiber: round1(rnd(0, 5)),
        sugar: round1(rnd(0, 9))
      }
    }
  ]

  const tw = w1 + w2
  const tp = round1(p1 + p2)
  const tc = round1(c1 + c2)
  const tf = round1(f1 + f2)
  const tcal = cal1 + cal2
  const pe = tp * 4
  const ce = tc * 4
  const fe = tf * 9
  const te = pe + ce + fe
  const pp = te > 0 ? Math.round((pe / te) * 100) : 0
  const cp = te > 0 ? Math.round((ce / te) * 100) : 0
  const fp = te > 0 ? Math.round((fe / te) * 100) : 0

  return {
    description: `【调试预览】随机样本：估算总重约 ${tw}g，总热量约 ${tcal} kcal。数据每次点击都会变化，仅用于看样式。`,
    insight: `【调试】随机营养汇总：蛋白质约 ${tp}g、碳水约 ${tc}g、脂肪约 ${tf}g。供能占比约 蛋白 ${pp}% / 碳水 ${cp}% / 脂肪 ${fp}%。`,
    items,
    pfc_ratio_comment: `三大营养素供能比例（调试随机）：蛋白质约 ${pp}%、碳水化合物约 ${cp}%、脂肪约 ${fp}%。`,
    absorption_notes: `【调试】吸收与利用：示例占位文案，便于检查「吸收与利用」区块样式。`,
    context_advice: `【调试】情境建议：示例占位文案，便于检查「情境建议」区块样式。`
  }
}
