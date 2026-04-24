import type { MembershipPeriod, MembershipStatus, MembershipTier } from './api'

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

const FOOD_ANALYSIS_CREDIT_COST = 2
const EXERCISE_LOG_CREDIT_COST = 1

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
      status.daily_credits_remaining != null
    )
  )
  const max = Math.max(Number(status?.daily_credits_max ?? 0), 0)
  const used = Math.max(Number(status?.daily_credits_used ?? 0), 0)
  const remaining = Math.max(Number(status?.daily_credits_remaining ?? 0), 0)
  return { hasInfo, max, used, remaining }
}

export function isFoodAnalysisCreditExhausted(status?: MembershipStatus | null): boolean {
  const { hasInfo, max, remaining } = getMembershipCreditSummary(status)
  if (!hasInfo) return false
  if (max <= 0) return true
  return remaining < FOOD_ANALYSIS_CREDIT_COST
}

export function getFoodAnalysisCreditBlockMessage(status?: MembershipStatus | null): string {
  const { hasInfo, max, used, remaining } = getMembershipCreditSummary(status)
  if (!hasInfo) {
    return `当前积分不足，食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。`
  }
  if (max <= 0) {
    return status?.is_pro
      ? `当前套餐暂无可用积分，食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。请升级更高套餐后继续。`
      : `当前暂无可用积分，食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。请开通会员后继续。`
  }
  if (status?.is_pro) {
    return `今日积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。请明日再试，或升级更高套餐。`
  }
  if (status?.trial_active) {
    return `试用积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。请明日再试，或开通会员继续。`
  }
  return `当前积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），食物分析需 ${FOOD_ANALYSIS_CREDIT_COST} 积分/次。请开通会员后继续。`
}

export function getFoodAnalysisBlockedActionText(status?: MembershipStatus | null): string {
  return status?.is_pro ? '去升级' : '去开通'
}

export function isExerciseLogCreditExhausted(status?: MembershipStatus | null): boolean {
  const { hasInfo, max, remaining } = getMembershipCreditSummary(status)
  if (!hasInfo) return false
  if (max <= 0) return true
  return remaining < EXERCISE_LOG_CREDIT_COST
}

export function getExerciseLogCreditBlockMessage(status?: MembershipStatus | null): string {
  const { hasInfo, max, used, remaining } = getMembershipCreditSummary(status)
  if (!hasInfo) {
    return `当前积分不足，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。`
  }
  if (max <= 0) {
    return status?.is_pro
      ? `当前套餐暂无可用积分，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请升级更高套餐后继续。`
      : `当前暂无可用积分，运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请开通会员后继续。`
  }
  if (status?.is_pro) {
    return `今日积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请明日再试，或升级更高套餐。`
  }
  if (status?.trial_active) {
    return `试用积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请明日再试，或开通会员继续。`
  }
  return `当前积分不足（已用 ${Math.min(used, max)}/${max}，剩余 ${remaining}），运动记录需 ${EXERCISE_LOG_CREDIT_COST} 积分/次。请开通会员后继续。`
}

export function getExerciseLogBlockedActionText(status?: MembershipStatus | null): string {
  return status?.is_pro ? '去升级' : '去开通'
}
