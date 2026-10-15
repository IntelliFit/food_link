import { useCallback, useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getStoredHomeExperienceConfig, HOME_EXPERIENCE_MODE_EVENT, saveHomeExperienceConfig, type HomeExperienceMode } from '../utils/home-experience'

/** Reconcile cached home pages with account-scoped preferences and other tabs. */
export function useHomeExperienceMode() {
  const [mode, setMode] = useState(() => getStoredHomeExperienceConfig().mode)
  const sync = useCallback(() => setMode(getStoredHomeExperienceConfig().mode), [])
  useEffect(() => {
    Taro.eventCenter.on(HOME_EXPERIENCE_MODE_EVENT, sync)
    sync()
    return () => { Taro.eventCenter.off(HOME_EXPERIENCE_MODE_EVENT, sync) }
  }, [sync])
  useDidShow(sync)
  const changeMode = useCallback((next: HomeExperienceMode) => {
    const current = getStoredHomeExperienceConfig()
    if (current.mode === next) { setMode(next); return false }
    setMode(saveHomeExperienceConfig({ version: 2, mode: next }).mode)
    return true
  }, [])
  return { mode, changeMode }
}
