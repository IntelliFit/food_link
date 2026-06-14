export interface DailyHonorTitleInput {
  intakeCurrentKcal: number
  intakeTargetKcal: number
  proteinCurrentGram: number
  proteinTargetGram: number
  carbsCurrentGram: number
  carbsTargetGram: number
  fatCurrentGram: number
  fatTargetGram: number
  waterProgressPct: number
  exerciseKcal: number
  streakDays: number
  greenDays: number
}

export interface DailyHonorTitleResult {
  title: string
  reason: string
}

function safeRatio(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0
  return current / target
}

function macroKcal(proteinGram: number, carbsGram: number, fatGram: number): { protein: number; carbs: number; fat: number; total: number } {
  const protein = Math.max(0, proteinGram) * 4
  const carbs = Math.max(0, carbsGram) * 4
  const fat = Math.max(0, fatGram) * 9
  return { protein, carbs, fat, total: protein + carbs + fat }
}

/**
 * 根据首页可用指标，生成当日称号（单一称号，按优先级命中）。
 */
export function resolveDailyHonorTitle(input: DailyHonorTitleInput): DailyHonorTitleResult {
  const intakeRatio = safeRatio(input.intakeCurrentKcal, input.intakeTargetKcal)
  const proteinRatio = safeRatio(input.proteinCurrentGram, input.proteinTargetGram)
  const carbsRatio = safeRatio(input.carbsCurrentGram, input.carbsTargetGram)
  const fatRatio = safeRatio(input.fatCurrentGram, input.fatTargetGram)

  const macros = macroKcal(input.proteinCurrentGram, input.carbsCurrentGram, input.fatCurrentGram)
  const proteinShare = macros.total > 0 ? macros.protein / macros.total : 0
  const carbsShare = macros.total > 0 ? macros.carbs / macros.total : 0
  const fatShare = macros.total > 0 ? macros.fat / macros.total : 0

  if (input.exerciseKcal >= 220 && input.waterProgressPct >= 90 && intakeRatio >= 0.78 && intakeRatio <= 0.98) {
    return { title: '减肥专家', reason: '运动和饮食控制都很在线' }
  }

  if (proteinRatio >= 1.25 && proteinShare >= 0.32 && input.exerciseKcal >= 100) {
    return { title: '蛋白质女王', reason: '高蛋白结构非常稳定' }
  }

  if (carbsShare >= 0.52 && fatShare <= 0.22 && fatRatio <= 0.9) {
    return { title: '素食主义者', reason: '今日饮食明显偏清爽植物系' }
  }

  if (input.streakDays >= 7 && input.greenDays >= 5 && input.waterProgressPct >= 80 && intakeRatio >= 0.9 && intakeRatio <= 1.1) {
    return { title: '美食博主', reason: '连续打卡与饮食结构都很均衡' }
  }

  if (intakeRatio >= 1.18 || input.intakeCurrentKcal >= Math.max(2400, input.intakeTargetKcal + 300)) {
    return { title: '顶级吃货', reason: '今日摄入能量拉满' }
  }

  if (carbsRatio <= 0.85 && proteinRatio >= 1 && fatRatio >= 0.8 && intakeRatio <= 1) {
    return { title: '减肥专家', reason: '热量控制与营养分配都很克制' }
  }

  return { title: '美食博主', reason: '保持记录就是最好的习惯' }
}
