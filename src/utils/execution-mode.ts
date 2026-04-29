import Taro from '@tarojs/taro'
import type { ExecutionMode, MembershipStatus } from './api'
import {
  getCurrentMembershipPeriod,
  getCurrentMembershipTier,
  getMembershipTierLabel,
  isPrecisionSupportedTier,
} from './membership'
import { extraPkgUrl } from './subpackage-extra'

export const STRICT_MODE_ENABLED = true

export const normalizeAvailableExecutionMode = (value: unknown): ExecutionMode => {
  return value === 'strict' ? 'strict' : 'standard'
}

export const canUseStrictModeForMembership = (membershipStatus?: MembershipStatus | null): boolean => {
  return Boolean(
    membershipStatus?.is_pro &&
    isPrecisionSupportedTier(getCurrentMembershipTier(membershipStatus)),
  )
}

export const getStrictModeUpgradeUrl = (
  membershipStatus?: Pick<MembershipStatus, 'current_plan_code'> | null,
  source = 'precision_upgrade',
): string => {
  const targetPeriod = getCurrentMembershipPeriod(membershipStatus) || 'monthly'
  return `${extraPkgUrl('/pages/pro-membership/index')}?target_tier=standard&target_period=${targetPeriod}&source=${source}`
}

export const getStrictModeUpgradeDialog = (
  membershipStatus?: MembershipStatus | null,
  source = 'precision_upgrade',
): {
  content: string
  confirmText: string
  lockedHint: string
  url: string
} => {
  const currentTier = getCurrentMembershipTier(membershipStatus)
  const url = getStrictModeUpgradeUrl(membershipStatus, source)

  if (membershipStatus?.is_pro && currentTier === 'light') {
    return {
      content: `你当前是${getMembershipTierLabel(currentTier)}，暂不支持精准模式。升级到标准版或进阶版后即可使用，是否前往升级？`,
      confirmText: '去升级',
      lockedHint: '当前轻度版不含精准模式，升级到标准版或进阶版可解锁',
      url,
    }
  }

  return {
    content: '精准模式仅对标准版和进阶版开放，是否前往开通？',
    confirmText: '去开通',
    lockedHint: '开通标准版或进阶版可解锁精准模式',
    url,
  }
}

export const getStrictModeLockedHint = (membershipStatus?: MembershipStatus | null): string => {
  return getStrictModeUpgradeDialog(membershipStatus).lockedHint
}

/**
 * 弹窗提示用户：精准模式当前不可用。
 * - 轻度版会员：提示去升级
 * - 非会员 / 试用：提示去开通标准版及以上
 * - 取消：调用 onCancel（通常用于回退到标准模式）
 */
export const promptStrictModeUpgrade = (options?: {
  membershipStatus?: MembershipStatus | null
  onCancel?: () => void
  cancelText?: string
  source?: string
}) => {
  const dialog = getStrictModeUpgradeDialog(options?.membershipStatus, options?.source)
  Taro.showModal({
    title: '解锁精准模式',
    content: dialog.content,
    confirmText: dialog.confirmText,
    cancelText: options?.cancelText || '取消',
    success: (res) => {
      if (res.confirm) {
        Taro.navigateTo({ url: dialog.url })
      } else {
        options?.onCancel?.()
      }
    }
  })
}

export const notifyStrictModeUnavailable = (
  membershipStatus?: MembershipStatus | null,
  options?: {
    onCancel?: () => void
    cancelText?: string
    source?: string
  },
) => {
  promptStrictModeUpgrade({
    membershipStatus,
    onCancel: options?.onCancel,
    cancelText: options?.cancelText,
    source: options?.source,
  })
}
