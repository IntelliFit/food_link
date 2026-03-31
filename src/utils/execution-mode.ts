import Taro from '@tarojs/taro'
import type { ExecutionMode } from './api'

export const STRICT_MODE_ENABLED = false
export const STRICT_MODE_DISABLED_MESSAGE = '该功能仍在完善中'

export const normalizeAvailableExecutionMode = (value: unknown): ExecutionMode => {
  if (!STRICT_MODE_ENABLED) {
    return 'standard'
  }
  return value === 'strict' ? 'strict' : 'standard'
}

export const notifyStrictModeUnavailable = () => {
  Taro.showToast({
    title: STRICT_MODE_DISABLED_MESSAGE,
    icon: 'none'
  })
}
