import * as Notifications from 'expo-notifications'
import { recordRegistrationDiagnostic, type RegistrationCode, type DiagnosticKind } from '../diagnostics/notificationDiagnostics'

type TokenStage = 'native' | 'expo'
const messages: Record<TokenStage, string> = {
  native: '未取得手机原生推送凭据',
  expo: '手机原生推送凭据已取得，但 Expo 注册未成功',
}

/** Only allowlisted classifications may leave this function; never retain a raw error. */
export function pushRegistrationCode(cause: unknown): RegistrationCode {
  const error = cause as { code?: unknown; message?: unknown } | null
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message.slice(0, 1024) : ''
  if (code === 'FOODLINK_PUSH_TIMEOUT') return 'TIMEOUT'
  if (/\b(?:AUTHENTICATION_FAILED|FIS_AUTH_ERROR)\b/.test(message)) return 'AUTHENTICATION_FAILED'
  if (/\bSERVICE_NOT_AVAILABLE\b/.test(message)) return 'SERVICE_NOT_AVAILABLE'
  if (code === 'ERR_NOTIFICATIONS_NETWORK_ERROR' || /(?:Network request failed|UnknownHostException|Unable to resolve host)/.test(message)) return 'NETWORK_ERROR'
  if (['ERR_NOTIFICATIONS_NO_EXPERIENCE_ID', 'ERR_NOTIFICATIONS_NO_APPLICATION_ID'].includes(code)) return 'CONFIGURATION_ERROR'
  if (code === 'ERR_NOTIFICATIONS_SERVER_ERROR') return 'PROVIDER_ERROR'
  return 'UNKNOWN'
}

export class PushRegistrationError extends Error {
  constructor(readonly stage: TokenStage, readonly diagnosticCode: RegistrationCode) {
    super(messages[stage] + '（' + diagnosticCode + '）。请复制“通知诊断”用于定位；重新打开 APP 后可再保存。')
    this.name = 'PushRegistrationError'
  }
}

/** Same 20-second total budget as before; separating stages must not double the wait. */
export async function getReminderExpoToken(projectId: string, owner: string, isSessionCurrent: () => Promise<boolean>): Promise<string> {
  const deadline = Date.now() + 20000
  const stage = async <T>(name: TokenStage, work: () => Promise<T>): Promise<T> => {
    if (!await isSessionCurrent()) throw new Error('账号状态已改变，请重新进入提醒设置')
    const prefix = name === 'native' ? 'native_token' : 'expo_token'
    await recordRegistrationDiagnostic(owner, (prefix + '_requested') as DiagnosticKind)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const remaining = deadline - Date.now()
      const timeout = Object.assign(new Error('Push operation deadline'), { code: 'FOODLINK_PUSH_TIMEOUT' })
      if (remaining <= 0) throw timeout
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout), remaining) }),
      ])
      if (!await isSessionCurrent()) throw new Error('账号状态已改变，请重新进入提醒设置')
      await recordRegistrationDiagnostic(owner, (prefix + '_ready') as DiagnosticKind)
      return result
    } catch (cause) {
      if (!await isSessionCurrent()) throw new Error('账号状态已改变，请重新进入提醒设置')
      const code = pushRegistrationCode(cause)
      await recordRegistrationDiagnostic(owner, (prefix + '_failed') as DiagnosticKind, code)
      throw new PushRegistrationError(name, code)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const devicePushToken = await stage('native', () => Notifications.getDevicePushTokenAsync())
  // The SDK supports passing the token so it does not acquire it a second time.
  const result = await stage('expo', () => Notifications.getExpoPushTokenAsync({ projectId, devicePushToken }))
  return result.data
}
