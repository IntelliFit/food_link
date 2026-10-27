import * as Notifications from 'expo-notifications'
import { AppState, NativeModules, Platform } from 'react-native'
import { getStoredUserId } from '../api'

export const LOCAL_CHECK_SOURCE = 'foodlink-local-check'
export const REMINDER_CHANNEL_ID = 'foodlink-reminders'
export type DiagnosticKind = 'fcm_received' | 'expo_forwarded' | 'expo_forward_failed' | 'foreground_received'
  | 'foreground_allowed' | 'foreground_suppressed' | 'opened' | 'local_scheduled' | 'local_received'
  | 'local_opened' | 'local_seen' | 'local_not_seen'
  | 'native_token_requested' | 'native_token_ready' | 'native_token_failed'
  | 'expo_token_requested' | 'expo_token_ready' | 'expo_token_failed'
  | 'device_binding_requested' | 'device_binding_ready' | 'device_binding_failed'
export type RegistrationCode = 'TIMEOUT' | 'NETWORK_ERROR' | 'SERVICE_NOT_AVAILABLE' | 'AUTHENTICATION_FAILED'
  | 'CONFIGURATION_ERROR' | 'PROVIDER_ERROR' | 'BACKEND_ERROR' | 'UNKNOWN'
const registrationCodes: RegistrationCode[] = ['TIMEOUT', 'NETWORK_ERROR', 'SERVICE_NOT_AVAILABLE', 'AUTHENTICATION_FAILED',
  'CONFIGURATION_ERROR', 'PROVIDER_ERROR', 'BACKEND_ERROR', 'UNKNOWN']
export type DiagnosticEvent = { kind: DiagnosticKind; at: number; id: string; state: string; code?: RegistrationCode }
export type NativeDiagnosticSnapshot = {
  version: string; versionCode: number; googleServices: 'enabled' | 'disabled' | 'not-installed'
  network: string[]; networkValidated: boolean; powerSave: boolean; deviceIdle: boolean
  batteryExempt: boolean; exactAlarmAllowed: boolean; pendingLocalCheckCount?: number
  postedReminderCount: number; events: DiagnosticEvent[]
}
type DiagnosticsModule = {
  setOwner(owner: string | null): Promise<void>
  record(owner: string | null, kind: DiagnosticKind, identifier: string, state: string): Promise<void>
  recordRegistration?(owner: string, kind: DiagnosticKind, identifier: string, state: string, code: string): Promise<void>
  clear(owner: string | null): Promise<void>
  snapshot(owner: string | null): Promise<NativeDiagnosticSnapshot>
}
const native = NativeModules.FoodLinkNotificationDiagnostics as DiagnosticsModule | undefined

export const diagnosticLabels: Record<DiagnosticKind, string> = {
  fcm_received: '原生接收器收到远程消息', expo_forwarded: '已交给 Expo 处理（不等于显示）',
  expo_forward_failed: '交给 Expo 处理时发生异常', foreground_received: 'APP 前台收到远程消息',
  foreground_allowed: '前台处理器允许显示', foreground_suppressed: '前台处理器未允许显示',
  opened: '用户点击远程通知', local_scheduled: '本地自检已安排', local_received: 'APP 前台收到本地自检',
  local_opened: '用户点击本地自检', local_seen: '用户确认看到了本地自检', local_not_seen: '用户反馈未看到本地自检',
  native_token_requested: '开始获取手机原生推送凭据', native_token_ready: '已取得手机原生推送凭据', native_token_failed: '手机原生推送凭据获取失败',
  expo_token_requested: '开始向 Expo 注册', expo_token_ready: 'Expo 注册成功', expo_token_failed: 'Expo 注册失败',
  device_binding_requested: '开始绑定本机到账号', device_binding_ready: '本机账号绑定成功', device_binding_failed: '本机账号绑定失败',
}

export function hasNativeNotificationDiagnostics() {
  return Platform.OS === 'android' && !!native?.snapshot
}

/** Auth bootstrap must complete before calling; do not erase background events on every launch. */
export async function syncNotificationDiagnosticOwner(owner: string | null) {
  if (!native) return
  await native.setOwner(owner)
  // A delayed local check must not outlive an account switch/logout.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  await Promise.all(scheduled.filter((item) => item.content.data?.source === LOCAL_CHECK_SOURCE &&
    item.content.data?.user_id !== (owner ?? '')).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)))
}

export async function recordDiagnostic(kind: DiagnosticKind, identifier: string) {
  if (!native) return
  try { await native.record(await getStoredUserId(), kind, identifier, AppState.currentState) } catch { /* Never affect delivery. */ }
}

/** Explicit expected owner and bounded error codes; no credential/error text is stored. */
export async function recordRegistrationDiagnostic(owner: string, kind: DiagnosticKind, code?: RegistrationCode) {
  if (!native?.recordRegistration) return
  try {
    if (owner !== await getStoredUserId()) return
    await native.recordRegistration(owner, kind, 'push-registration', AppState.currentState,
      code && registrationCodes.includes(code) ? code : '')
  } catch { /* Diagnostics must not block registration. */ }
}

export async function observeNotification(notification: Notifications.Notification, kind: DiagnosticKind) {
  const data = notification.request.content.data || {}
  if (!['foodlink-reminder', LOCAL_CHECK_SOURCE].includes(String(data.source))) return
  if (data.user_id !== (await getStoredUserId() ?? '')) return
  await recordDiagnostic(kind, notification.request.identifier)
}

/** Only listener setup, never generates a notification or sends a network request. */
export function listenForNotificationDiagnostics() {
  const received = Notifications.addNotificationReceivedListener((notification) => {
    const local = notification.request.content.data?.source === LOCAL_CHECK_SOURCE
    void observeNotification(notification, local ? 'local_received' : 'foreground_received').catch(() => undefined)
  })
  // Clicks (including cold-start responses) are recorded by RootNavigator after its owner check.
  return () => { received.remove() }
}

export async function readNotificationDiagnostics() {
  if (!hasNativeNotificationDiagnostics()) throw new Error('当前安装包不含 Android 原生诊断，请安装诊断包')
  const owner = await getStoredUserId()
  const [snapshot, scheduled] = await Promise.all([native!.snapshot(owner), Notifications.getAllScheduledNotificationsAsync()])
  return { ...snapshot, pendingLocalCheckCount: scheduled.filter((item) =>
    item.content.data?.source === LOCAL_CHECK_SOURCE && item.content.data?.user_id === (owner ?? '')).length }
}

export async function clearNotificationDiagnostics() {
  if (native) await native.clear(await getStoredUserId())
}

/** Explicit user tap only; generic content, same business channel, no remote push/API. */
export async function scheduleLocalNotificationCheck(): Promise<string> {
  if (!hasNativeNotificationDiagnostics()) throw new Error('请使用 Android 诊断安装包进行自检')
  const owner = await getStoredUserId()
  const permission = await Notifications.getPermissionsAsync()
  if (!permission.granted) throw new Error('系统通知未允许，请先到系统设置开启；自检不会代你修改权限')
  const channel = await Notifications.getNotificationChannelAsync(REMINDER_CHANNEL_ID)
  if (!channel) {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: '饮食与保质期提醒', importance: Notifications.AndroidImportance.HIGH,
    })
  } else if (channel.importance === Notifications.AndroidImportance.NONE) {
    throw new Error('饮食与保质期提醒通道已关闭，请先到系统设置开启')
  }
  if (owner !== await getStoredUserId()) throw new Error('账号状态已改变，请重试')
  const id = `foodlink-local-check-${globalThis.expo.uuidv4()}`
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: '食探本地通知自检', body: '这是一条手机本地产生的通知，不代表远程推送已送达。', sound: 'default',
      data: { source: LOCAL_CHECK_SOURCE, user_id: owner ?? '' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, repeats: false, channelId: REMINDER_CHANNEL_ID },
  })
  if (owner !== await getStoredUserId()) {
    await Notifications.cancelScheduledNotificationAsync(id)
    throw new Error('账号状态已改变，本次自检已取消')
  }
  await recordDiagnostic('local_scheduled', id)
  return id
}

export function notificationDiagnosticReport(snapshot: NativeDiagnosticSnapshot, permission: boolean, channel: string): string {
  // Allowlist the export shape. Never serialize notification requests or arbitrary native output.
  return JSON.stringify({ type: 'foodlink-notification-diagnostics-v1', exportedAt: new Date().toISOString(),
    version: snapshot.version, versionCode: snapshot.versionCode, permission, channel,
    googleServices: snapshot.googleServices, network: snapshot.network, networkValidated: snapshot.networkValidated,
    powerSave: snapshot.powerSave, deviceIdle: snapshot.deviceIdle, batteryExempt: snapshot.batteryExempt,
    exactAlarmAllowed: snapshot.exactAlarmAllowed, pendingLocalCheckCount: snapshot.pendingLocalCheckCount,
    postedReminderCount: snapshot.postedReminderCount,
    events: snapshot.events.map(({ kind, at, id, state, code }) => ({
      kind, at, id, state, ...(code && registrationCodes.includes(code) ? { code } : {}),
    })),
    limitations: '仅为本机观察；本地调度可能延后；无记录不证明未收到；转交/系统已发布不证明用户看见；网络验证不证明FCM连通。',
  }, null, 2)
}
