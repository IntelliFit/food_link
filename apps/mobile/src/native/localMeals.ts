import { NativeModules, Platform } from 'react-native'
import type { ReminderPreferences } from '@food-link/core'

export type LocalMealSnapshot = {
  enabled: boolean; exactAlarmAllowed: boolean; owner?: string
  next: Array<{ meal: string; due: number }>
  events: Array<{ at: number; meal: string; state: string; due: number }>
}
type Module = {
  configure(owner: string, json: string): Promise<string>
  session(owner: string | null): Promise<string>
  clear(): Promise<string>
  snapshot(): Promise<string>
  openAlarmSettings(): Promise<string>
  recorded(owner: string, date: string, meals: string): Promise<string>
}
const native: Module | undefined = Platform.OS === 'android' ? NativeModules.FoodLinkLocalMeals : undefined
export const supportsLocalMeals = () => !!native
export async function localMealSnapshot(): Promise<LocalMealSnapshot | null> {
  return native ? JSON.parse(await native.snapshot()) as LocalMealSnapshot : null
}
export async function configureLocalMeals(owner: string, p: ReminderPreferences): Promise<LocalMealSnapshot> {
  if (!native) throw new Error('请安装包含本机定时提醒的新版 Android 安装包')
  // Do not store any remote-device IDs, tokens, photos or health data natively.
  return JSON.parse(await native.configure(owner, JSON.stringify({ enabled: p.enabled, meal_enabled: p.meal_enabled,
    breakfast_time: p.breakfast_time, lunch_time: p.lunch_time, dinner_time: p.dinner_time,
    timezone: p.timezone, quiet_start: p.quiet_start, quiet_end: p.quiet_end }))) as LocalMealSnapshot
}
export async function syncLocalMealSession(owner: string | null) { await native?.session(owner) }
export async function clearLocalMeals() { await native?.clear() }
export async function setLocalRecordedMeals(owner: string, date: string, meals: string[]) {
  await native?.recorded(owner, date, JSON.stringify([...new Set(meals)]))
}
export async function openExactAlarmSettings() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return
  // Explicit user action; no automatic battery exemption or alarm privilege grant.
  await native?.openAlarmSettings()
}
