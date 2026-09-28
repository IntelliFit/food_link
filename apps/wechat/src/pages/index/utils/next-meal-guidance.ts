import type { CanonicalMealType } from '../../../utils/api'

export type MainMealType = 'breakfast' | 'lunch' | 'dinner'

export type NextMealGuidance = {
  title: string
  detail: string
}

type MacroSnapshot = {
  calories: { current: number; target: number }
  protein: { current: number; target: number }
  carbs: { current: number; target: number }
  fat: { current: number; target: number }
}

const safeRatioRemaining = (current: number, target: number): number => {
  if (!(target > 0)) return 0
  return Math.max(0, (target - current) / target)
}

export function normalizeNextMainMeal(mealType: CanonicalMealType | string | undefined): MainMealType {
  if (mealType === 'breakfast') return 'breakfast'
  if (mealType === 'lunch' || mealType === 'morning_snack') return 'lunch'
  return 'dinner'
}

export function nextMealLabel(mealType: MainMealType): string {
  if (mealType === 'breakfast') return '早餐'
  if (mealType === 'lunch') return '午餐'
  return '晚餐'
}

/**
 * 首页只给不收费的方向性建议，不重复展示热量和宏量数字。
 * 具体菜品、份量和场景约束留给宠物对话继续确认。
 */
export function buildNextMealGuidance(snapshot: MacroSnapshot): NextMealGuidance {
  const calorieRemaining = safeRatioRemaining(snapshot.calories.current, snapshot.calories.target)
  const proteinRemaining = safeRatioRemaining(snapshot.protein.current, snapshot.protein.target)
  const carbsRemaining = safeRatioRemaining(snapshot.carbs.current, snapshot.carbs.target)
  const fatRemaining = safeRatioRemaining(snapshot.fat.current, snapshot.fat.target)

  if (calorieRemaining <= 0.15 || fatRemaining <= 0.08) {
    return {
      title: '这餐清淡一些，优先低脂蛋白',
      detail: '可选低脂瘦肉、鱼虾或豆制品，多配蔬菜，主食少量即可',
    }
  }
  if (proteinRemaining >= 0.25 && proteinRemaining >= carbsRemaining * 0.8) {
    return {
      title: '优先补蛋白，搭配适量主食',
      detail: '可选瘦肉、鸡蛋或豆制品，配一份主食和蔬菜',
    }
  }
  if (carbsRemaining >= 0.35 && carbsRemaining > proteinRemaining * 1.2) {
    return {
      title: '主食可以吃够，同时补一点蛋白',
      detail: '可选米饭、杂粮或薯类，搭配一份肉蛋奶和蔬菜',
    }
  }
  return {
    title: '按均衡餐来搭配就好',
    detail: '一份主食、一份优质蛋白，再配足量蔬菜',
  }
}
