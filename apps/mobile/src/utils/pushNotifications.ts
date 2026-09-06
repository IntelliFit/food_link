import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const NOTIFICATION_CHANNEL_ID = 'foodlink-general'
const smokeTestEnabled = process.env.EXPO_PUBLIC_NOTIFICATION_SMOKE_TEST === '1'

let smokeTestStarted = false

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: '智健食探通知',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#00BC7D',
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  if (existing.granted) return true

  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

async function tryRemoteSelfPush(): Promise<void> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    console.warn('[push-smoke] remote skipped: EAS project ID is missing')
    return
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId })
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token.data,
        title: '智健食探远程推送测试',
        body: '这条消息来自 Expo Push Service，无需应用商店上架。',
        sound: 'default',
        priority: 'high',
        data: { source: 'notification-smoke-test', delivery: 'remote' },
      }),
    })

    if (!response.ok) {
      throw new Error(`Expo Push Service HTTP ${response.status}`)
    }

    const result = (await response.json()) as {
      data?: {
        status?: string
        message?: string
        details?: { error?: string }
      }
    }
    if (result.data?.status !== 'ok') {
      const reason = result.data?.details?.error ?? result.data?.message ?? 'unknown ticket status'
      throw new Error(`Expo Push Service rejected notification: ${reason}`)
    }
    console.info('[push-smoke] remote notification accepted by Expo Push Service')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[push-smoke] remote unavailable: ${message}`)
  }
}

async function scheduleLocalProof(): Promise<void> {
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: '智健食探通知测试',
      body: '未上架的内测 APK 也可以显示系统通知。',
      sound: 'default',
      data: { source: 'notification-smoke-test', delivery: 'local' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10,
      channelId: NOTIFICATION_CHANNEL_ID,
    },
  })
  console.info(`[push-smoke] local notification scheduled: ${identifier}`)
}

export async function runNotificationSmokeTest(): Promise<void> {
  if (!smokeTestEnabled || smokeTestStarted) return
  smokeTestStarted = true

  try {
    const permitted = await ensureNotificationPermission()
    if (!permitted) {
      console.warn('[push-smoke] notification permission denied')
      return
    }

    await scheduleLocalProof()
    await tryRemoteSelfPush()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[push-smoke] setup failed: ${message}`)
  }
}
