import Taro from '@tarojs/taro'
import type { PetChatLocation } from './api'

// Account-scoped session memory only: no coordinates in storage or navigation URLs.
let sharedFix: { owner: string; location: PetChatLocation } | undefined

export function rememberMealLocation(owner: string, location?: PetChatLocation): PetChatLocation | undefined {
  const fresh = freshMealLocation(location)
  sharedFix = owner && fresh ? { owner, location: { ...fresh } } : undefined
  return fresh
}

export function currentMealLocation(owner: string): PetChatLocation | undefined {
  if (!owner || sharedFix?.owner !== owner || !freshMealLocation(sharedFix.location)) {
    sharedFix = undefined
    return undefined
  }
  return { ...sharedFix.location }
}

export function freshMealLocation(location: PetChatLocation | undefined, now = Date.now()): PetChatLocation | undefined {
  if (!location || location.coordinate_type !== 'gcj02') return undefined
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return undefined
  if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return undefined
  if (location.latitude === 0 && location.longitude === 0) return undefined
  if (location.accuracy_m !== undefined && (!Number.isFinite(location.accuracy_m) || location.accuracy_m < 0 || location.accuracy_m > 3000)) return undefined
  if (!Number.isFinite(location.captured_at) || location.captured_at > now + 60000 || now - location.captured_at > 30 * 60000) return undefined
  return location
}

// Whether the user has already allowed location; asking never shows a prompt.
export async function mealLocationAllowed(): Promise<boolean> {
  try {
    const settings = await Taro.getSetting()
    return settings.authSetting['scope.userLocation'] === true
  } catch {
    return false
  }
}

// A meal question asked without a fresh location, by a user who already allowed location: read
// it silently so the first answer can search nearby instead of asking where they are. Gives up
// after timeoutMs; any failure just means no location.
export async function silentMealLocation(owner: string, timeoutMs = 3000): Promise<PetChatLocation | undefined> {
  if (!owner) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const fix = await Promise.race([
      Taro.getLocation({ type: 'gcj02' }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('location timeout')), timeoutMs) }),
    ])
    return rememberMealLocation(owner, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, captured_at: Date.now(), coordinate_type: 'gcj02' })
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
