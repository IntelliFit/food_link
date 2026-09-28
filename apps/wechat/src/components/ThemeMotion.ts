import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import * as React from 'react'

export const THEME_MOTION_KEY = 'balanced_theme_motion_v1'
export const THEME_MOTION_EVENT = 'fl_balanced_theme_motion_changed'

function readMotion() {
  try { return Taro.getStorageSync(THEME_MOTION_KEY) !== false } catch { return true }
}

/** Cached tabs share the preference; hidden pages stop decorative animation. */
export function useThemeMotion() {
  const [enabled, updateEnabled] = React.useState(readMotion)
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => {
    const sync = (value: boolean) => updateEnabled(typeof value === 'boolean' ? value : readMotion())
    Taro.eventCenter.on(THEME_MOTION_EVENT, sync)
    return () => { Taro.eventCenter.off(THEME_MOTION_EVENT, sync) }
  }, [])
  useDidShow(() => {
    if (!visible) setVisible(true)
    const stored = readMotion()
    if (stored !== enabled) updateEnabled(stored)
  })
  useDidHide(() => { setVisible(false) })
  const setEnabled = React.useCallback((next: boolean) => {
    updateEnabled(next)
    try { Taro.setStorageSync(THEME_MOTION_KEY, next) } catch { /* The current session still works without storage. */ }
    Taro.eventCenter.trigger(THEME_MOTION_EVENT, next)
  }, [])
  return { enabled, active: enabled && visible, setEnabled }
}
