import Taro from '@tarojs/taro'
import {
  defaultHomeModuleLayout, migrateHomeModuleLayout, normalizeHomeModuleLayout,
  HOME_MODULE_LAYOUT_PREFIX, PREVIOUS_HOME_MODULE_LAYOUT_PREFIX, LEGACY_HOME_MODULE_LAYOUT_PREFIX,
  type HomeModuleLayout,
} from '@food-link/core'

export {
  HOME_MODULES, HOME_QUICK_STATS, defaultHomeModuleLayout, normalizeHomeModuleLayout,
  moveHomeModule, homeModuleLocks, isHomeModuleVisible, isHomeQuickStatVisible, toggleHomeQuickStat,
  HOME_MODULE_LAYOUT_PREFIX, type HomeModuleId, type HomeQuickStatId, type HomeLayoutDensity,
  type HomeModuleLayout, type HomeModuleLocks,
} from '@food-link/core'

export function homeLayoutOwner(): string {
  return String(Taro.getStorageSync('user_id') || 'guest')
}

export function readHomeModuleLayout(): HomeModuleLayout {
  try {
    const owner = homeLayoutOwner()
    const current = Taro.getStorageSync(HOME_MODULE_LAYOUT_PREFIX + owner)
    if (current) return normalizeHomeModuleLayout(current)
    const previous = Taro.getStorageSync(PREVIOUS_HOME_MODULE_LAYOUT_PREFIX + owner)
    const legacy = Taro.getStorageSync(LEGACY_HOME_MODULE_LAYOUT_PREFIX + owner)
    const migrated = migrateHomeModuleLayout(previous, legacy)
    Taro.setStorageSync(HOME_MODULE_LAYOUT_PREFIX + owner, migrated)
    return migrated
  } catch { return defaultHomeModuleLayout() }
}

export function saveHomeModuleLayout(layout: HomeModuleLayout): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  Taro.setStorageSync(HOME_MODULE_LAYOUT_PREFIX + homeLayoutOwner(), normalized)
  return normalized
}
