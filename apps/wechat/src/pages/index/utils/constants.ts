import { type HomeIntakeData } from '../../../utils/api'
import { type SimpleTargetState } from '../types/index'

export const DEFAULT_INTAKE: HomeIntakeData = {
  current: 0,
  target: 2000,
  progress: 0,
  macros: {
    protein: { current: 0, target: 120 },
    carbs: { current: 0, target: 250 },
    fat: { current: 0, target: 65 }
  }
}

export const WEIGHT_HISTORY_LIMIT = 60
export const QUICK_WATER_AMOUNTS = [200, 350, 500]
export const WATER_GOAL_DEFAULT = 2000

export const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const SHORT_DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

// 档位映射到实际数值（1-20档）
export const LEVEL_TO_GRAMS = {
  protein: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  carbs: [50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500, 550],
  fat: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110]
}

export const DEFAULT_SIMPLE_TARGET: SimpleTargetState = {
  proteinLevel: 8,   // 默认80g蛋白质
  carbsLevel: 10,    // 默认275g碳水
  fatLevel: 8        // 默认50g脂肪
}

/** 首页摄入超标/警示用色（柔和红，与 `index.scss` 中 `$home-warning-red` 保持一致） */
export const HOME_WARNING_RED = '#e57373'
