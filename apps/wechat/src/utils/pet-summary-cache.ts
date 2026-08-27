import Taro from '@tarojs/taro'
import type { PetSummary } from './api'

export const PET_SUMMARY_CACHE_KEY = 'pet_summary_cache_v1'

interface StoredPetProfile {
  user_id: string
  updated_at: number
  pet: PetSummary['pet']
}

function currentUserID(): string {
  try {
    return String(Taro.getStorageSync('user_id') || '').trim()
  } catch (_) {
    return ''
  }
}

function isValidPetProfile(value: unknown): value is PetSummary['pet'] {
  const pet = value as PetSummary['pet'] | null | undefined
  return Boolean(pet?.id && pet.name)
}

function todayDateKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function getStoredPetSummary(): PetSummary | null {
  const userID = currentUserID()
  if (!userID) return null
  try {
    const stored = Taro.getStorageSync(PET_SUMMARY_CACHE_KEY) as StoredPetProfile | undefined
    if (stored?.user_id !== userID || !isValidPetProfile(stored.pet)) return null
    return {
      pet: stored.pet,
      today: { date: todayDateKey(), habit_score: 0, exp_gained: 0, details: {} },
      status: { mood: 'calm', state: 'steady', message: '', task_text: '' },
      rewards: { daily_credit_cap: 0 },
    }
  } catch (_) {
    return null
  }
}

export function saveStoredPetSummary(summary: PetSummary): void {
  const userID = currentUserID()
  if (!userID || !isValidPetProfile(summary?.pet)) return
  const {
    needs_selection: _needsSelection,
    selection_candidates: _selectionCandidates,
    free_profile_rematch_available: _freeProfileRematchAvailable,
    ...stablePet
  } = summary.pet
  try {
    Taro.setStorageSync(PET_SUMMARY_CACHE_KEY, {
      user_id: userID,
      updated_at: Date.now(),
      pet: stablePet,
    } satisfies StoredPetProfile)
  } catch (_) {
    // 缓存失败不影响宠物接口的正常展示。
  }
}

export async function loadPetSummaryWithRetry(
  fetchSummary: () => Promise<PetSummary>,
  retryDelayMs = 350,
): Promise<PetSummary> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const summary = await fetchSummary()
      if (!isValidPetProfile(summary?.pet)) {
        throw new Error('宠物状态数据不完整')
      }
      saveStoredPetSummary(summary)
      return summary
    } catch (error) {
      lastError = error
      if (attempt === 0 && retryDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('加载宠物状态失败')
}
