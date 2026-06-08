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

  const buildNutrients = (cal: number, p: number, c: number, f: number) => ({
    calories: cal,
    protein: p,
    carbs: c,
    fat: f,
    fiber: round1(rnd(0, 8)),
    sugar: round1(rnd(0, 16)),
    water_ml: round1(rnd(30, 180)),
    sodium_mg: Math.round(rnd(80, 620)),
    potassiumMg: Math.round(rnd(120, 580)),
    calciumMg: Math.round(rnd(10, 120)),
    ironMg: round1(rnd(0.3, 4.5)),
    magnesiumMg: Math.round(rnd(8, 55)),
    zincMg: round1(rnd(0.2, 3.5)),
    vitaminARaeMcg: Math.round(rnd(5, 85)),
    vitaminCMg: round1(rnd(1, 45)),
    vitaminDMcg: round1(rnd(0.1, 2.5)),
    vitaminEMg: round1(rnd(0.2, 4.0)),
    vitaminKMcg: Math.round(rnd(2, 45)),
    thiaminMg: round1(rnd(0.02, 0.35)),
    riboflavinMg: round1(rnd(0.03, 0.4)),
    niacinMg: round1(rnd(0.3, 5.5)),
    vitaminB6Mg: round1(rnd(0.05, 0.6)),
    folateMcg: Math.round(rnd(5, 65)),
    vitaminB12Mcg: round1(rnd(0.05, 1.8)),
    saturatedFat: round1(rnd(0.5, 8)),
    cholesterolMg: Math.round(rnd(5, 95)),
  })

  const items: FoodItem[] = [
    {
      itemId: 1,
      name: '调试 · 咖喱鸡饭',
      estimatedWeightGrams: w1,
      originalWeightGrams: w1,
      water_ml: round1(rnd(50, 150)),
      nutrients: buildNutrients(cal1, p1, c1, f1)
    },
    {
      itemId: 2,
      name: '调试 · 蔬菜沙拉',
      estimatedWeightGrams: w2,
      originalWeightGrams: w2,
      water_ml: round1(rnd(40, 120)),
      nutrients: buildNutrients(cal2, p2, c2, f2)
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
    eating_order_advice: `【调试】进食顺序：示例占位文案，便于检查「进食顺序」区块样式。`,
    absorption_notes: `【调试】吸收与利用：示例占位文案，便于检查「吸收与利用」区块样式。`,
    context_advice: `【调试】情境建议：示例占位文案，便于检查「情境建议」区块样式。`
  }
}
