import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Linking, Platform } from 'react-native'
import { apiClient, getStoredUserId, hasStoredToken } from '../api'
import type { ReminderMealType, ReminderPreferences, ReminderSettings } from '@food-link/core'
import { LOCAL_CHECK_SOURCE, observeNotification, recordRegistrationDiagnostic } from '../diagnostics/notificationDiagnostics'
import { getReminderExpoToken } from './pushRegistration'
import { getHonorPushRegistration, isHonorPushConfigured } from '../native/honorPush'
import { clearLocalMeals, configureLocalMeals, localMealSnapshot, setLocalRecordedMeals, supportsLocalMeals, syncLocalMealSession } from '../native/localMeals'

const INSTALLATION_KEY = 'mobile_push_installation_v1'
const BOUND_OWNER_KEY = 'mobile_push_bound_owner_v1'
const CHANNEL_ID = 'foodlink-reminders'
// Identity keys intentionally survive user-cache clearing, so logout can still unbind.
let suspended = true
let boundOwner: string | null = null
let queue: Promise<unknown> = Promise.resolve()
let localQueue: Promise<unknown> = Promise.resolve()
let localRecordsFlight: Promise<void> | null = null
let localRecordsDirty = false
function serializedLocal<T>(work: () => Promise<T>): Promise<T> {
  const next = localQueue.then(work, work)
  localQueue = next.catch(() => undefined)
  return next
}

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

export function setReminderSessionActive(active: boolean) {
  suspended = !active
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data || {}
    const allowed = data.source === LOCAL_CHECK_SOURCE
      ? data.user_id === (await getStoredUserId() ?? '')
      : data.source !== 'foodlink-reminder' || (
        !suspended && await hasStoredToken() && data.user_id === await getStoredUserId()
      )
    void observeNotification(notification, allowed ? 'foreground_allowed' : 'foreground_suppressed').catch(() => undefined)
    return { shouldShowBanner: allowed, shouldShowList: allowed, shouldPlaySound: allowed, shouldSetBadge: false }
  },
})

export async function hasNotificationPermission(): Promise<boolean> {
  const permission = await Notifications.getPermissionsAsync()
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
}

export type ReminderChannelStatus = 'not-applicable' | 'not-created' | 'blocked' | 'standard' | 'banner' | 'unknown'

/** Overall permission alone does not tell whether the reminder channel can pop up. */
export async function getReminderChannelStatus(): Promise<ReminderChannelStatus> {
  if (Platform.OS !== 'android') return 'not-applicable'
  try {
    const channel = await Notifications.getNotificationChannelAsync(CHANNEL_ID)
    if (!channel) return 'not-created'
    if (channel.importance === Notifications.AndroidImportance.NONE) return 'blocked'
    return channel.importance >= Notifications.AndroidImportance.HIGH ? 'banner' : 'standard'
  } catch {
    return 'unknown'
  }
}

export async function openReminderNotificationSettings(): Promise<void> {
  const packageName = Constants.expoConfig?.android?.package
  const channelStatus = await getReminderChannelStatus()
  if (Platform.OS === 'android' && packageName && ['banner', 'standard', 'blocked'].includes(channelStatus)) {
    try {
      await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
        { key: 'android.provider.extra.CHANNEL_ID', value: CHANNEL_ID },
      ])
      return
    } catch {
      // Older/custom Android builds may only support the app-level settings screen.
    }
  }
  await Linking.openSettings()
}

async function installationId(): Promise<string> {
  const stored = await AsyncStorage.getItem(INSTALLATION_KEY)
  if (stored) return stored
  // Expo's native UUID generator is already present; no extra crypto/native dependency.
  const id = globalThis.expo.uuidv4()
  await AsyncStorage.setItem(INSTALLATION_KEY, id)
  return id
}

async function registerCurrentDevice(requestPermission: boolean) {
  const owner = await getStoredUserId()
  if (!owner || suspended || !await hasStoredToken()) throw new Error('请先登录后开启提醒')
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('请使用 Android 或 iOS 内测安装包开启提醒')
  if (Constants.appOwnership === 'expo') throw new Error('远程提醒需要独立安装包，不支持 Expo Go')
  await ensureReminderPermission(requestPermission)
  const id = await installationId()
  const isCurrent = async () => !suspended && owner === await getStoredUserId() && await hasStoredToken()
  let registration: { token: string; project_id: string; provider: 'expo' | 'honor' } | null = null
  if (isHonorPushConfigured()) {
    const settings = await apiClient.getReminderSettings()
    if (!await isCurrent()) throw new Error('账号状态已改变，请重新进入提醒设置')
    if (settings.push_available && settings.push_providers?.includes('honor')) {
      registration = await getHonorPushRegistration()
    }
  }
  if (!registration) {
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    if (typeof projectId !== 'string' || !projectId) throw new Error('当前安装包缺少推送项目配置')
    const token = await getReminderExpoToken(projectId, owner, isCurrent)
    registration = { token, project_id: projectId, provider: 'expo' }
  }
  if (suspended || owner !== await getStoredUserId()) throw new Error('账号状态已改变，请重新进入提醒设置')
  await recordRegistrationDiagnostic(owner, 'device_binding_requested')
  try {
    await apiClient.registerPushDevice(id, { ...registration, platform: Platform.OS, protocol_version: 2 })
    await recordRegistrationDiagnostic(owner, 'device_binding_ready')
  } catch (cause) {
    await recordRegistrationDiagnostic(owner, 'device_binding_failed', 'BACKEND_ERROR')
    throw cause
  }
  boundOwner = owner
  await AsyncStorage.setItem(BOUND_OWNER_KEY, owner)
}

async function ensureReminderPermission(requestPermission: boolean) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      // Applies only to a new channel. Never delete/recreate an existing channel to
      // override the user's choice; the settings page explains how to enable banners.
      name: '饮食与保质期提醒', importance: Notifications.AndroidImportance.HIGH,
    })
  }
  let permitted = await hasNotificationPermission()
  if (!permitted && requestPermission) {
    await Notifications.requestPermissionsAsync()
    permitted = await hasNotificationPermission()
  }
  if (!permitted) throw new Error('系统通知未允许，请在系统设置中开启通知')
  if (await getReminderChannelStatus() === 'blocked') {
    throw new Error('系统已关闭饮食与保质期提醒，请在系统通知设置中开启该通道后再保存')
  }
}

/** Local meals do not wait for a Google push-token request to succeed. */
export function saveBusinessReminderSettings(p: ReminderPreferences): Promise<ReminderSettings> {
  if (!supportsLocalMeals()) return serialized(async () => {
    if (p.enabled) await registerCurrentDevice(true)
    if (suspended || !await hasStoredToken()) throw new Error('请先登录后保存提醒')
    return apiClient.saveReminderSettings(p)
  })
  return serializedLocal(async () => {
    const owner = await getStoredUserId()
    if (!owner || suspended || !await hasStoredToken()) throw new Error('请先登录后保存提醒')
    if (p.enabled) await ensureReminderPermission(true)
    const id = await installationId()
    const result = await apiClient.saveLocalMealSettings(id, p)
    if (!result.local_meal_supported || !result.preferences.local_meal_devices?.includes(id)) {
      throw new Error('服务端尚未启用本机三餐分流，暂未创建本机提醒，请更新后端后重试')
    }
    if (suspended || owner !== await getStoredUserId()) throw new Error('账号状态已改变，请重新进入提醒设置')
    try { await configureLocalMeals(owner, result.preferences) } catch {
      throw new Error('设置已存到服务端，但手机未完成定时安排。请重新保存；暂不能按已开启本机三餐使用。')
    }
    return result
  })
}

async function updateLocalMealRecords() {
  const owner = await getStoredUserId()
  const snapshot = await localMealSnapshot()
  if (suspended || !owner || snapshot?.owner !== owner || !snapshot.enabled) return
  const settings = await apiClient.getReminderSettings()
  if (suspended || owner !== await getStoredUserId()) return
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: settings.preferences.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (kind: string) => parts.find(part => part.type === kind)?.value || ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const result = await apiClient.getFoodRecordList(date)
  if (!suspended && owner === await getStoredUserId()) await setLocalRecordedMeals(owner, date, result.records.map(r => r.meal_type))
}

export function refreshLocalMealRecords(): Promise<void> {
  localRecordsDirty = true
  if (!localRecordsFlight) localRecordsFlight = (async () => {
    do {
      localRecordsDirty = false
      await updateLocalMealRecords()
    } while (localRecordsDirty && !suspended)
  })().finally(() => { localRecordsFlight = null })
  return localRecordsFlight
}

/** Only a deliberate tap on the settings page may request OS permission. */
export function enableReminderDevice(): Promise<void> {
  return serialized(() => registerCurrentDevice(true))
}

export function refreshReminderDevice(): Promise<void> {
  return serializedLocal(async () => {
    if (suspended) return
    const owner = await getStoredUserId()
    await syncLocalMealSession(owner)
    const settings = await apiClient.getReminderSettings()
    if (suspended || !owner || owner !== await getStoredUserId()) return
    if (supportsLocalMeals()) {
      const id = await installationId()
      if (settings.local_meal_supported && settings.preferences.local_meal_devices?.includes(id)) {
        await configureLocalMeals(owner, settings.preferences)
        void refreshLocalMealRecords().catch(() => undefined)
      }
    }
    if (!await hasNotificationPermission()) return
    if (!settings.push_available || !settings.preferences.enabled || suspended) return
    // Remote token acquisition can stall on some networks. Never hold the local save queue for it.
    void serialized(() => registerCurrentDevice(false)).catch(() => undefined)
  })
}

/** Fail closed: keep login credentials if a known remote binding cannot be revoked. */
export function revokeReminderDevice(): Promise<void> {
  suspended = true
  return serialized(async () => {
    const owner = await getStoredUserId()
    const binding = boundOwner || await AsyncStorage.getItem(BOUND_OWNER_KEY)
    const id = await AsyncStorage.getItem(INSTALLATION_KEY)
    try {
      if (owner && binding === owner && id) await apiClient.unregisterPushDevice(id)
      await serializedLocal(() => clearLocalMeals())
      boundOwner = null
      await AsyncStorage.removeItem(BOUND_OWNER_KEY)
      await Notifications.dismissAllNotificationsAsync()
      Notifications.clearLastNotificationResponse()
    } catch {
      suspended = false
      throw new Error('暂时无法解绑本机提醒，登录状态已保留。请联网后再退出。')
    }
  })
}

export type ReminderDestination =
  | { route: 'PrivateChat'; userId: string }
  | { route: 'AnalyzeHistory' }
  | { route: 'MealSuggestions'; mealType: ReminderMealType }
  | { route: 'DayRecord'; date: string }
  | { route: 'Expiry' }

export async function reminderDestination(response: Notifications.NotificationResponse): Promise<ReminderDestination | null> {
  return reminderDataDestination(response.notification.request.content.data || {})
}

export async function reminderDataDestination(data: Record<string, unknown>): Promise<ReminderDestination | null> {
  const [owner, authenticated] = await Promise.all([getStoredUserId(), hasStoredToken()])
  if (suspended || data.source !== 'foodlink-reminder' || !authenticated || data.user_id !== owner) return null
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof data.event_id === 'string' && uuid.test(data.event_id)) {
    if (data.kind === 'analysis_completed' && data.route === 'AnalyzeHistory') return { route: 'AnalyzeHistory' }
    if (data.kind === 'private_message' && data.route === 'PrivateChat' && typeof data.sender_id === 'string' && uuid.test(data.sender_id)
      && data.sender_id !== owner && data.sender_id !== '00000000-0000-0000-0000-000000000000') {
      return { route: 'PrivateChat', userId: data.sender_id }
    }
  }
  if (data.route === 'Expiry') return { route: 'Expiry' }
  if (data.route === 'MealSuggestions' && ['breakfast', 'lunch', 'dinner'].includes(String(data.meal_type))) {
    return { route: 'MealSuggestions', mealType: data.meal_type as ReminderMealType }
  }
  if (data.route === 'DayRecord' && typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    const date = new Date(`${data.date}T12:00:00Z`)
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === data.date) return { route: 'DayRecord', date: data.date }
  }
  return null
}
