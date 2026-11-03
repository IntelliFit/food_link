import Taro from '@tarojs/taro'
import type { EatingMood } from './api'

export const EATING_MOOD_OPTIONS: ReadonlyArray<{ value: EatingMood; emoji: string; label: string }> = [
  { value: 'happy', emoji: '😊', label: '开心' },
  { value: 'calm', emoji: '😌', label: '平静' },
  { value: 'stressed', emoji: '😣', label: '压力大' },
  { value: 'tired', emoji: '😮‍💨', label: '疲惫' },
  { value: 'bored', emoji: '😶', label: '无聊' },
  { value: 'treat', emoji: '✨', label: '犒劳自己' },
]

const STORAGE_KEY = 'analyzeEatingMood'

const isEatingMood = (value: unknown): value is EatingMood => (
  EATING_MOOD_OPTIONS.some((option) => option.value === value)
)

/**
 * 心情在拍照页选好后随任务提交，结果页不再显示。
 * 打开哪个任务就以哪个任务里的为准，没有就清空，避免把上一次的选择悄悄存进这一餐。
 */
export function persistEatingMoodFromPayload(payload: Record<string, unknown> | undefined): void {
  const mood = payload?.eating_mood
  if (isEatingMood(mood)) {
    Taro.setStorageSync(STORAGE_KEY, mood)
  } else {
    Taro.removeStorageSync(STORAGE_KEY)
  }
}

export function readPersistedEatingMood(): EatingMood | null {
  const mood = Taro.getStorageSync(STORAGE_KEY)
  return isEatingMood(mood) ? mood : null
}

export function clearPersistedEatingMood(): void {
  Taro.removeStorageSync(STORAGE_KEY)
}
