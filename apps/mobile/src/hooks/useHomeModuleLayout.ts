import { useCallback, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { HOME_MODULE_LAYOUT_PREFIX, PREVIOUS_HOME_MODULE_LAYOUT_PREFIX, LEGACY_HOME_MODULE_LAYOUT_PREFIX, defaultHomeModuleLayout, migrateHomeModuleLayout, normalizeHomeModuleLayout, type HomeModuleLayout } from '@food-link/core'
import { getStoredUserId } from '../api'

export function useHomeModuleLayout(userId: string, authenticated: boolean) {
  const owner = authenticated ? userId : 'guest'
  const [stored, setStored] = useState<{ owner: string; layout: HomeModuleLayout } | null>(null)
  useFocusEffect(useCallback(() => {
    let active = true
    if (!owner) return
    void (async () => {
      const value = await AsyncStorage.getItem(HOME_MODULE_LAYOUT_PREFIX + owner)
      if (value) return normalizeHomeModuleLayout(JSON.parse(value))
      const [previous, legacy] = await Promise.all([
        AsyncStorage.getItem(PREVIOUS_HOME_MODULE_LAYOUT_PREFIX + owner),
        AsyncStorage.getItem(LEGACY_HOME_MODULE_LAYOUT_PREFIX + owner),
      ])
      const layout = migrateHomeModuleLayout(previous ? JSON.parse(previous) : null, legacy ? JSON.parse(legacy) : null)
      await AsyncStorage.setItem(HOME_MODULE_LAYOUT_PREFIX + owner, JSON.stringify(layout))
      return layout
    })().then(layout => {
      if (!active) return
      setStored({ owner, layout })
    }).catch(() => { if (active) setStored({ owner, layout: defaultHomeModuleLayout() }) })
    return () => { active = false }
  }, [owner]))
  const save = async (value: HomeModuleLayout) => {
    if (!owner || owner !== ((await getStoredUserId()) || 'guest')) throw new Error('登录状态已变化，请重新打开整理首页')
    const layout = normalizeHomeModuleLayout(value)
    await AsyncStorage.setItem(HOME_MODULE_LAYOUT_PREFIX + owner, JSON.stringify(layout))
    // 不把前一账户的布局应用到下一账户；键和值始终属于捕获的 owner。
    setStored({ owner, layout })
  }
  return { layout: stored?.owner === owner ? stored.layout : defaultHomeModuleLayout(), ready: stored?.owner === owner, save }
}
