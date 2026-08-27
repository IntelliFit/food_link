import Taro from '@tarojs/taro'
import type { PetSummary } from '../../src/utils/api'
import {
  getStoredPetSummary,
  loadPetSummaryWithRetry,
  PET_SUMMARY_CACHE_KEY,
  saveStoredPetSummary,
} from '../../src/utils/pet-summary-cache'

const storage = new Map<string, unknown>()

function currentDateKey(): string {
  const today = new Date()
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function summary(name = '豆豆'): PetSummary {
  return {
    pet: {
      id: 'pet-1',
      pet_seed: 'seed-1',
      name,
      color: 'mint',
      shape: 'round',
      pattern: 'pattern-0',
      accessory: 'leaf',
      personality: 'gentle',
      level: 1,
      experience: 0,
      level_exp: 0,
      next_level_exp: 100,
      level_progress: 0,
      total_events: 0,
      avatar_type: 'builtin_person',
      builtin_avatar_id: 'doudou-01',
    },
    today: { date: currentDateKey(), habit_score: 0, exp_gained: 0, details: {} },
    status: { mood: 'calm', state: 'steady', message: '', task_text: '' },
    rewards: { daily_credit_cap: 1 },
  }
}

describe('pet summary cache and retry', () => {
  beforeEach(() => {
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
    storage.set('user_id', 'user-a')
  })

  it('keeps the last successful pet isolated to the current user', () => {
    saveStoredPetSummary(summary())
    expect(getStoredPetSummary()?.pet.name).toBe('豆豆')
    expect(storage.get(PET_SUMMARY_CACHE_KEY)).toEqual(expect.objectContaining({ user_id: 'user-a' }))

    storage.set('user_id', 'user-b')
    expect(getStoredPetSummary()).toBeNull()
  })

  it('retries once and caches the successful response', async () => {
    const fetchSummary = jest.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(summary('小麦'))

    await expect(loadPetSummaryWithRetry(fetchSummary, 0)).resolves.toEqual(summary('小麦'))
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    expect(getStoredPetSummary()?.pet.name).toBe('小麦')
  })

  it('does not erase the last successful pet after both attempts fail', async () => {
    saveStoredPetSummary(summary('华佗'))
    const fetchSummary = jest.fn().mockRejectedValue(new Error('offline'))

    await expect(loadPetSummaryWithRetry(fetchSummary, 0)).rejects.toThrow('offline')
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    expect(getStoredPetSummary()?.pet.name).toBe('华佗')
  })

  it('persists only the stable pet profile instead of date-scoped status and rewards', () => {
    const value = summary('当前宠物')
    value.pet.needs_selection = true
    value.pet.selection_candidates = [{
      id: 'candidate-1',
      pet_seed: 'seed-2',
      name: '候选宠物',
      color: 'blue',
      shape: 'round',
      pattern: 'plain',
      accessory: 'none',
      personality: 'gentle',
    }]
    value.pet.free_profile_rematch_available = true
    saveStoredPetSummary(value)

    const stored = storage.get(PET_SUMMARY_CACHE_KEY)
    expect(stored).toEqual(expect.objectContaining({
      user_id: 'user-a',
      pet: expect.objectContaining({ name: '当前宠物' }),
    }))
    expect(stored).not.toEqual(expect.objectContaining({
      summary: expect.anything(),
      status: expect.anything(),
      rewards: expect.anything(),
    }))
    expect((stored as { pet: Record<string, unknown> }).pet).not.toEqual(expect.objectContaining({
      needs_selection: expect.anything(),
      selection_candidates: expect.anything(),
      free_profile_rematch_available: expect.anything(),
    }))
  })
})
