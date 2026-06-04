import type { ExecutionMode, MembershipPeriod, MembershipStatus, MembershipTier } from './api'

const MEMBERSHIP_TIER_LABELS: Record<MembershipTier, string> = {
  light: '轻度版',
  standard: '标准版',
  advanced: '进阶版',
}

const MEMBERSHIP_TIER_SHORT_LABELS: Record<MembershipTier, string> = {
  light: '轻度',
  standard: '标准',
  advanced: '进阶',
}

const MEMBERSHIP_PERIOD_LABELS: Record<MembershipPeriod, string> = {
  monthly: '月卡',
  quarterly: '季卡',
  yearly: '年卡',
}

const TIER_ORDER: Record<MembershipTier, number> = {
  light: 1,
  standard: 2,
  advanced: 3,
}

const STANDARD_FOOD_ANALYSIS_CREDIT_COST = 2
const PRECISION_FOOD_ANALYSIS_CREDIT_COST = 4
const EXERCISE_LOG_CREDIT_COST = 1

export const LOW_CREDIT_REWARD_HINT_THRESHOLD = 4

export interface CreditShortageInfoOptions {
  requiredCredits: number
  scenarioLabel?: string
  message?: string
}

export interface CreditShortageInfo {
  requiredCredits: number
  totalAvailable: number
  systemRemaining: number
  earnedBalance: number
  missingCredits: number
  message: string
  membershipActionText: string
}

export function getFoodAnalysisCreditCost(executionMode?: ExecutionMode | string | null, units = 1): number {
  const normalizedUnits = Number.isFinite(units) && units > 0 ? Math.floor(units) : 1
  const unitCost = executionMode === 'strict' ||
    executionMode === 'strict_separate' ||
    executionMode === 'strict_web_search' ||
    executionMode === 'experimental' ||
    executionMode === 'gemini35_flash_grouped'
    ? PRECISION_FOOD_ANALYSIS_CREDIT_COST
    : STANDARD_FOOD_ANALYSIS_CREDIT_COST
  return unitCost * normalizedUnits
}

function getFoodAnalysisCreditLabel(executionMode?: ExecutionMode | string | null): string {
  if (executionMode === 'fast') return '快速分析'
  if (executionMode === 'fast_web_search') return '快速联网分析'
  if (executionMode === 'standard_packaged_experiment') return '零食库试验分析'
  if (executionMode === 'experimental') return '试验分析'
  if (executionMode === 'standard_web_search') return '联网分析'
  if (executionMode === 'strict_separate') return '精准分项分析'
  if (executionMode === 'strict_web_search') return '联网精准分析'
  if (executionMode === 'strict') return '精准分析'
  if (executionMode === 'gemini35_flash' || executionMode === 'gemini35_flash_grouped') return '精准分析'
  return '食物分析'
}

export function getMembershipTierFromPlanCode(planCode?: string | null): MembershipTier | null {
  const code = String(planCode || '').trim()
  if (!code) return null
  if (code.startsWith('light_')) return 'light'
  if (code.startsWith('standard_')) return 'standard'
  if (code.startsWith('advanced_')) return 'advanced'
  return null
}

export function getMembershipPeriodFromPlanCode(planCode?: string | null): MembershipPeriod | null {
  const code = String(planCode || '').trim()
  if (!code) return null
  if (code.endsWith('_monthly')) return 'monthly'
  if (code.endsWith('_quarterly')) return 'quarterly'
  if (code.endsWith('_yearly')) return 'yearly'
  return null
}

export function getMembershipTierLabel(tier?: MembershipTier | null): string {
  return tier ? MEMBERSHIP_TIER_LABELS[tier] : '会员'
}

export function getMembershipTierShortLabel(tier?: MembershipTier | null): string {
  return tier ? MEMBERSHIP_TIER_SHORT_LABELS[tier] : '会员'
}

export function getMembershipPeriodLabel(period?: MembershipPeriod | null): string {
  return period ? MEMBERSHIP_PERIOD_LABELS[period] : ''
}

export function isPrecisionSupportedTier(tier?: MembershipTier | null): boolean {
  return tier === 'standard' || tier === 'advanced'
}

export function isPrecisionSupportedPlanCode(planCode?: string | null): boolean {
  return isPrecisionSupportedTier(getMembershipTierFromPlanCode(planCode))
}

export function compareMembershipTier(
  left?: MembershipTier | null,
  right?: MembershipTier | null,
): number {
  if (!left || !right) return 0
  return TIER_ORDER[left] - TIER_ORDER[right]
}

export function getCurrentMembershipTier(status?: Pick<MembershipStatus, 'current_plan_code'> | null): MembershipTier | null {
  return getMembershipTierFromPlanCode(status?.current_plan_code)
}

export function getCurrentMembershipPeriod(status?: Pick<MembershipStatus, 'current_plan_code'> | null): MembershipPeriod | null {
  return getMembershipPeriodFromPlanCode(status?.current_plan_code)
}

export function getFounderPaidBonusSource(status?: MembershipStatus | null): 'registration_top_1000' | 'paid_top_100' | 'both' | null {
  const source = status?.early_user_paid_bonus_source
  if (source === 'registration_top_1000' || source === 'paid_top_100' || source === 'both') {
    return source
  }
  return null
}

export function getFounderPaidBonusSourceLabel(status?: MembershipStatus | null): string | null {
  const source = getFounderPaidBonusSource(status)
  const registrationLimit = status?.early_user_limit ?? 1000
  const paidLimit = status?.early_paid_user_limit ?? 100
  if (source === 'both') return `前 ${registrationLimit} 注册用户 / 前 ${paidLimit} 付费用户`
  if (source === 'registration_top_1000') return `前 ${registrationLimit} 注册用户`
  if (source === 'paid_top_100') return `前 ${paidLimit} 付费用户`
  return null
}

export function getFounderPaidBonusRankLabel(status?: MembershipStatus | null): string | null {
  const source = getFounderPaidBonusSource(status)
  const registrationRank = status?.early_user_rank ?? null
  const registrationLimit = status?.early_user_limit ?? 1000
  const paidRank = status?.early_paid_user_rank ?? null
  const paidLimit = status?.early_paid_user_limit ?? 100

  if (source === 'both') {
    return `注册第 ${registrationRank ?? '--'} / ${registrationLimit} 位 · 付费第 ${paidRank ?? '--'} / ${paidLimit} 位`
  }
  if (source === 'registration_top_1000') {
    return `注册第 ${registrationRank ?? '--'} / ${registrationLimit} 位`
  }
  if (source === 'paid_top_100') {
    return `付费第 ${paidRank ?? '--'} / ${paidLimit} 位`
  }
  return null
}

export function getMembershipCreditSummary(status?: MembershipStatus | null): {
  hasInfo: boolean
  max: number
  used: number
  remaining: number
} {
  const hasInfo = Boolean(
    status &&
    (
      status.daily_credits_max != null ||
      status.daily_credits_used != null ||
      status.daily_credits_remaining != null ||
      status.total_credits_available != null
    )
  )
  const max = Math.max(Number(status?.daily_credits_max ?? 0), 0)
  const used = Math.max(Number(status?.daily_credits_used ?? 0), 0)
  const remaining = Math.max(Number(status?.total_credits_available ?? status?.daily_credits_remaining ?? 0), 0)
  return { hasInfo, max, used, remaining }
}

export function getSystemCreditsRemaining(status?: MembershipStatus | null): number {
  return Math.max(Number(status?.system_credits_remaining ?? 0), 0)
}

export function getEarnedCreditsBalance(status?: MembershipStatus | null): number {
  return Math.max(Number(status?.earned_credits_balance ?? 0), 0)
}

export function isFoodAnalysisCreditExhausted(
  status?: MembershipStatus | null,
  executionMode?: ExecutionMode | string | null,
  units = 1,
): boolean {
  const { hasInfo, max, remaining } = getMembershipCreditSummary(status)
  const creditCost = getFoodAnalysisCreditCost(executionMode, units)
  if (!hasInfo) return false
  if (remaining >= creditCost) return false
  if (max <= 0) return true
  return remaining < creditCost
}

export function getFoodAnalysisCreditBlockMessage(
  status?: MembershipStatus | null,
  executionMode?: ExecutionMode | string | null,
  units = 1,
): string {
  const { hasInfo, max, used, remaining } = getMembershipCreditSummary(status)
  const systemRemaining = getSystemCreditsRemaining(status)
  const earnedBalance = getEarnedCreditsBalance(status)
  const balanceSummary = `当前可用 ${remaining}（系统剩余 ${systemRemaining}，累计奖励 ${earnedBalance}）`
  const creditCost = getFoodAnalysisCreditCost(executionMode, units)
  const analysisLabel = getFoodAnalysisCreditLabel(executionMode)
  if (!hasInfo) {
    return `当前积分不足，${analysisLabel}需 ${creditCost} 积分/次。`
  }
  if (max <= 0 && remaining <= 0) {
    return status?.is_pro
      ? `当前套餐暂无可用积分，${analysisLabel}需 ${creditCost} 积分/次。请升级更高套餐后继续。`
      : `当前暂无可用积分，${analysisLabel}需 ${creditCost} 积分/次。请开通会员后继续。`
  }
  if (status?.is_pro) {
    return `当前积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），${analysisLabel}需 ${creditCost} 积分/次。系统积分次日刷新，奖励积分可继续累计。`
  }
  if (status?.trial_active) {
    return `试用积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），${analysisLabel}需 ${creditCost} 积分/次。系统积分次日刷新，奖励积分可继续累计。`
  }
  return `当前积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），${analysisLabel}需 ${creditCost} 积分/次。请开通会员后继续。`
}

export function getFoodAnalysisBlockedActionText(status?: MembershipStatus | null): string {
  return status?.is_pro ? '去升级' : '去开通'
}

export function buildCreditShortageInfo(
  status: MembershipStatus | null | undefined,
  options: CreditShortageInfoOptions,
): CreditShortageInfo {
  const requiredCredits = Math.max(Math.ceil(Number(options.requiredCredits || 0)), 1)
  const { remaining } = getMembershipCreditSummary(status)
  const systemRemaining = getSystemCreditsRemaining(status)
  const earnedBalance = getEarnedCreditsBalance(status)
  const missingCredits = Math.max(requiredCredits - remaining, 0)
  const scenarioLabel = String(options.scenarioLabel || '本次操作').trim() || '本次操作'
  const fallbackMessage = missingCredits > 0
    ? `${scenarioLabel}需要 ${requiredCredits} 积分，还差 ${missingCredits} 积分。可以先完成奖励任务赚积分，赚到后马上继续使用。`
    : `${scenarioLabel}需要 ${requiredCredits} 积分。可以先完成奖励任务赚积分，也可以开通会员获得更多每日积分。`
  return {
    requiredCredits,
    totalAvailable: remaining,
    systemRemaining,
    earnedBalance,
    missingCredits,
    message: options.message?.trim() || fallbackMessage,
    membershipActionText: status?.is_pro ? '去升级' : '开通会员',
  }
}

export function isExerciseLogCreditExhausted(status?: MembershipStatus | null): boolean {
  const { hasInfo, max, remaining } = getMembershipCreditSummary(status)
  if (!hasInfo) return false
  if (remaining >= EXERCISE_LOG_CREDIT_COST) return false
  if (max <= 0) return true
  return remaining < EXERCISE_LOG_CREDIT_COST
}

export function getExerciseLogCreditBlockMessage(status?: MembershipStatus | null): string {
  const { hasInfo, max, used, remaining } = getMembershipCreditSummary(status)
  const systemRemaining = getSystemCreditsRemaining(status)
  const earnedBalance = getEarnedCreditsBalance(status)
  const balanceSummary = `当前可用 ${remaining}（系统剩余 ${systemRemaining}，累计奖励 ${earnedBalance}）`
  if (!hasInfo) {
    return `当前积分不足，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。`
  }
  if (max <= 0 && remaining <= 0) {
    return status?.is_pro
      ? `当前套餐暂无可用积分，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请升级更高套餐后继续。`
      : `当前暂无可用积分，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请开通会员后继续。`
  }
  if (status?.is_pro) {
    return `当前积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。系统积分次日刷新，奖励积分可继续累计。`
  }
  if (status?.trial_active) {
    return `试用积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。系统积分次日刷新，奖励积分可继续累计。`
  }
  return `当前积分不足（已用 ${Math.min(used, max)}/${max}，${balanceSummary}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请开通会员后继续。`
}

export function getExerciseLogBlockedActionText(status?: MembershipStatus | null): string {
  return status?.is_pro ? '去升级' : '去开通'
}
