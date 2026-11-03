import Taro from '@tarojs/taro'
import { clearPersistedEatingMood, persistEatingMoodFromPayload, readPersistedEatingMood } from '../../src/utils/eating-mood'

const store = new Map<string, unknown>()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
  },
}))

describe('eating mood handoff', () => {
  beforeEach(() => {
    store.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key) ?? '')
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => { store.set(key, value) })
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation((key: string) => { store.delete(key) })
  })

  it('hands the mood on the task to the result page', () => {
    persistEatingMoodFromPayload({ eating_mood: 'calm' })
    expect(readPersistedEatingMood()).toBe('calm')
  })

  it('does not reuse the previous mood for a task without one', () => {
    persistEatingMoodFromPayload({ eating_mood: 'calm' })
    persistEatingMoodFromPayload({})
    expect(readPersistedEatingMood()).toBeNull()
  })

  it('ignores unknown moods', () => {
    persistEatingMoodFromPayload({ eating_mood: 'furious' })
    expect(readPersistedEatingMood()).toBeNull()
    store.set('analyzeEatingMood', 'furious')
    expect(readPersistedEatingMood()).toBeNull()
  })

  it('clears after the record is saved', () => {
    persistEatingMoodFromPayload({ eating_mood: 'treat' })
    clearPersistedEatingMood()
    expect(readPersistedEatingMood()).toBeNull()
  })
})
