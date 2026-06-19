import { type HomeIntakeData } from '../../../utils/api'
import { type TargetFormState, type SimpleTargetState, type WeekHeatmapCell, type WeekHeatmapState } from '../types/index'
import { LEVEL_TO_GRAMS, SHORT_DAY_NAMES } from './constants'

// 与识别结果页「更多营养」一致的 21 项微量元素，以及首页/目标弹窗使用的每日参考默认值
const MICRO_TARGET_DEFAULTS: Record<string, number> = {
  fiber: 25,
  sugar: 50,
  saturatedFat: 20,
  cholesterolMg: 300,
  sodiumMg: 2000,
  potassiumMg: 3500,
  calciumMg: 800,
  ironMg: 12,
  magnesiumMg: 330,
  zincMg: 12.5,
  vitaminARaeMcg: 700,
  vitaminCMg: 100,
  vitaminDMcg: 10,
  vitaminEMg: 14,
  vitaminKMcg: 80,
  thiaminMg: 1.4,
  riboflavinMg: 1.4,
  niacinMg: 15,
  vitaminB6Mg: 1.4,
  folateMcg: 400,
  vitaminB12Mcg: 2.4,
}

function getMicroTargetOrDefault(intake: HomeIntakeData, key: string): string {
  const raw = intake.micros?.[key]
  if (raw && typeof raw === 'object') {
    const target = (raw as unknown as Record<string, unknown>).target
    if (typeof target === 'number' && Number.isFinite(target) && target > 0) {
      return String(Math.round(target))
    }
  }
  const fallback = MICRO_TARGET_DEFAULTS[key]
  return fallback != null ? String(fallback) : ''
}

// 根据档位计算克数
export function getGramsFromLevel(type: 'protein' | 'carbs' | 'fat', level: number): number {
  const index = Math.max(0, Math.min(19, level - 1))
  return LEVEL_TO_GRAMS[type][index]
}

// 根据克数找到最接近的档位
export function getLevelFromGrams(type: 'protein' | 'carbs' | 'fat', grams: number): number {
  const values = LEVEL_TO_GRAMS[type]
  let closestLevel = 1
  let minDiff = Math.abs(values[0] - grams)
  
  for (let i = 1; i < values.length; i++) {
    const diff = Math.abs(values[i] - grams)
    if (diff < minDiff) {
      minDiff = diff
      closestLevel = i + 1
    }
  }
  
  return closestLevel
}

// 根据普通模式的档位计算卡路里
export function calculateCaloriesFromLevels(levels: SimpleTargetState): number {
  const proteinGrams = getGramsFromLevel('protein', levels.proteinLevel)
  const carbsGrams = getGramsFromLevel('carbs', levels.carbsLevel)
  const fatGrams = getGramsFromLevel('fat', levels.fatLevel)
  
  return proteinGrams * 4 + carbsGrams * 4 + fatGrams * 9
}

export function getGreeting(): { text: string; iconClass: string } {
  const h = new Date().getHours()
  if (h < 12) return { text: '早上好', iconClass: 'icon-zaoshang' }
  if (h < 18) return { text: '中午好', iconClass: 'icon-zhongwu' }
  return { text: '晚上好', iconClass: 'icon-wanshang' }
}

export function formatDisplayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatNumberWithComma(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

export function normalizeTo2025(dateStr: string): string {
  // 保持日期格式不变，仅确保格式统一
  return dateStr
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createTargetForm(intake: HomeIntakeData): TargetFormState {
  return {
    calorieTarget: String(Math.round(intake.target)),
    proteinTarget: String(intake.macros.protein.target),
    carbsTarget: String(intake.macros.carbs.target),
    fatTarget: String(intake.macros.fat.target),
    fiberTarget: getMicroTargetOrDefault(intake, 'fiber'),
    sugarTarget: getMicroTargetOrDefault(intake, 'sugar'),
    saturatedFatTarget: getMicroTargetOrDefault(intake, 'saturatedFat'),
    cholesterolMgTarget: getMicroTargetOrDefault(intake, 'cholesterolMg'),
    sodiumMgTarget: getMicroTargetOrDefault(intake, 'sodiumMg'),
    potassiumMgTarget: getMicroTargetOrDefault(intake, 'potassiumMg'),
    calciumMgTarget: getMicroTargetOrDefault(intake, 'calciumMg'),
    ironMgTarget: getMicroTargetOrDefault(intake, 'ironMg'),
    magnesiumMgTarget: getMicroTargetOrDefault(intake, 'magnesiumMg'),
    zincMgTarget: getMicroTargetOrDefault(intake, 'zincMg'),
    vitaminARaeMcgTarget: getMicroTargetOrDefault(intake, 'vitaminARaeMcg'),
    vitaminCMgTarget: getMicroTargetOrDefault(intake, 'vitaminCMg'),
    vitaminDMcgTarget: getMicroTargetOrDefault(intake, 'vitaminDMcg'),
    vitaminEMgTarget: getMicroTargetOrDefault(intake, 'vitaminEMg'),
    vitaminKMcgTarget: getMicroTargetOrDefault(intake, 'vitaminKMcg'),
    thiaminMgTarget: getMicroTargetOrDefault(intake, 'thiaminMg'),
    riboflavinMgTarget: getMicroTargetOrDefault(intake, 'riboflavinMg'),
    niacinMgTarget: getMicroTargetOrDefault(intake, 'niacinMg'),
    vitaminB6MgTarget: getMicroTargetOrDefault(intake, 'vitaminB6Mg'),
    folateMcgTarget: getMicroTargetOrDefault(intake, 'folateMcg'),
    vitaminB12McgTarget: getMicroTargetOrDefault(intake, 'vitaminB12Mcg'),
  }
}

export function createWeekHeatmapCells(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []

  for (let offset = -3; offset <= 3; offset++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset)

    const dateKey = formatDateKey(d)
    const dayIndex = d.getDay()

    cells.push({
      date: dateKey,
      dayName: SHORT_DAY_NAMES[dayIndex],
      dayNum: String(d.getDate()),
      calories: 0,
      target: 2000,
      intakeRatio: 0,
      state: 'none',
      isToday: offset === 0,
    })
  }

  return cells
}

// 获取营养状态
export function getMacroState(key: 'protein' | 'carbs' | 'fat', current: number, target: number): { label: string; color: string } {
  if (target === 0) return { label: '-', color: '#999' }
  
  const ratio = current / target
  
  if (key === 'protein') {
    if (ratio < 0.3) return { label: '不足', color: '#ff6b6b' }
    if (ratio < 0.7) return { label: '偏低', color: '#ffa94d' }
    if (ratio <= 1.1) return { label: '适中', color: '#00bc7d' }
    return { label: '充足', color: '#00a86e' }
  }
  
  if (key === 'carbs') {
    if (ratio < 0.3) return { label: '不足', color: '#ff6b6b' }
    if (ratio < 0.6) return { label: '偏低', color: '#ffa94d' }
    if (ratio <= 1.0) return { label: '适中', color: '#00bc7d' }
    if (ratio <= 1.3) return { label: '偏高', color: '#ffa94d' }
    return { label: '过量', color: '#ff6b6b' }
  }
  
  // fat
  if (ratio < 0.3) return { label: '不足', color: '#ff6b6b' }
  if (ratio < 0.6) return { label: '偏低', color: '#ffa94d' }
  if (ratio <= 0.9) return { label: '适中', color: '#00bc7d' }
  if (ratio <= 1.2) return { label: '偏高', color: '#ffa94d' }
  return { label: '过量', color: '#ff6b6b' }
}

// 获取摄入状态描述
export function getIntakeState(progress: number): { label: string; color: string } {
  if (progress === 0) return { label: '未开始', color: '#ccc' }
  if (progress < 0.3) return { label: '刚开始', color: '#ffa94d' }
  if (progress < 0.7) return { label: '进行中', color: '#00bc7d' }
  if (progress <= 1.0) return { label: '即将达标', color: '#00a86e' }
  return { label: '已超标', color: '#ff6b6b' }
}

// 根据热量缺口/盈余获取状态
export function getCalorieState(intakeRatio: number): WeekHeatmapState {
  if (intakeRatio === 0) return 'none'
  if (intakeRatio >= 1.0) return 'surplus'
  return 'deficit'
}
