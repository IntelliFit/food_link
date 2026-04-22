import Taro from '@tarojs/taro'
import type { ExecutionMode } from './api'
import { extraPkgUrl } from './subpackage-extra'

export const STRICT_MODE_ENABLED = true

export const normalizeAvailableExecutionMode = (value: unknown): ExecutionMode => {
  return value === 'strict' ? 'strict' : 'standard'
}

/**
 * 弹窗提示用户：精准模式需要开通会员。
 * - 确认（去开通）：跳转到会员页
 * - 取消：调用 onCancel（通常用于回退到标准模式）
 */
export const promptStrictModeUpgrade = (onCancel?: () => void) => {
  Taro.showModal({
    title: '解锁精准模式',
    content: '精准模式需要开通食探会员才能使用，是否前往开通？若取消则自动切换至标准模式。',
    confirmText: '去开通',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
      } else {
        onCancel?.()
      }
    }
  })
}
