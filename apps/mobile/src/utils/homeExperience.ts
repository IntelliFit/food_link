import AsyncStorage from '@react-native-async-storage/async-storage'

export type HomeExperienceMode = 'wellness' | 'balanced'

export interface HomeExperienceConfig {
  version: 2
  mode: HomeExperienceMode
}

const HOME_EXPERIENCE_STORAGE_KEY = 'home_experience_config_v2'
const LEGACY_HOME_EXPERIENCE_STORAGE_KEY = 'home_experience_config_v1'

export const DEFAULT_HOME_EXPERIENCE_CONFIG: HomeExperienceConfig = {
  version: 2,
  mode: 'balanced',
}

type HomeExperienceModeListener = (mode: HomeExperienceMode) => void
const homeExperienceModeListeners = new Set<HomeExperienceModeListener>()

export function onHomeExperienceModeChanged(listener: HomeExperienceModeListener): () => void {
  homeExperienceModeListeners.add(listener)
  return () => homeExperienceModeListeners.delete(listener)
}

function notifyHomeExperienceModeChanged(mode: HomeExperienceMode) {
  homeExperienceModeListeners.forEach((listener) => listener(mode))
}

function storageKey(prefix: string, userId: string): string {
  return `${prefix}:${userId.trim() || 'guest'}`
}

export function sanitizeHomeExperienceConfig(value: unknown): HomeExperienceConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_HOME_EXPERIENCE_CONFIG }
  return {
    version: 2,
    mode: (value as { mode?: unknown }).mode === 'wellness' ? 'wellness' : 'balanced',
  }
}

function parseStoredConfig(value: string | null): HomeExperienceConfig | null {
  if (!value) return null
  try {
    return sanitizeHomeExperienceConfig(JSON.parse(value))
  } catch {
    return null
  }
}

export async function getStoredHomeExperienceConfig(userId: string): Promise<HomeExperienceConfig> {
  try {
    const current = parseStoredConfig(await AsyncStorage.getItem(storageKey(HOME_EXPERIENCE_STORAGE_KEY, userId)))
    if (current) return current

    const legacy = parseStoredConfig(await AsyncStorage.getItem(storageKey(LEGACY_HOME_EXPERIENCE_STORAGE_KEY, userId)))
    return legacy || { ...DEFAULT_HOME_EXPERIENCE_CONFIG }
  } catch {
    return { ...DEFAULT_HOME_EXPERIENCE_CONFIG }
  }
}

export async function saveHomeExperienceConfig(userId: string, config: HomeExperienceConfig): Promise<HomeExperienceConfig> {
  const sanitized = sanitizeHomeExperienceConfig(config)
  notifyHomeExperienceModeChanged(sanitized.mode)
  try {
    await AsyncStorage.setItem(storageKey(HOME_EXPERIENCE_STORAGE_KEY, userId), JSON.stringify(sanitized))
  } catch {
    // 模式偏好保存失败不影响首页核心记录链路。
  }
  return sanitized
}