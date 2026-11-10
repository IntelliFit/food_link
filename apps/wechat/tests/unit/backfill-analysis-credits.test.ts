import type { MembershipStatus } from '../../src/utils/api'
import { getFoodAnalysisCreditStatusForDate, isFoodAnalysisCreditExhausted } from '../../src/utils/membership'

const status = (system: number, earned = 0): MembershipStatus => ({
  is_pro: false, status: 'inactive', daily_limit: null, daily_used: null, daily_remaining: null,
  daily_credits_max: 20, daily_credits_used: 20 - system,
  system_credits_remaining: system, earned_credits_balance: earned,
  total_credits_available: system + earned,
})

describe('analysis credits for the actual record date', () => {
  it.each([[0, 20], [2, 0], [1, 1]])('allows backfill with today=%i and target=%i', (today, target) => {
    const combined = getFoodAnalysisCreditStatusForDate(status(today), status(target), true)
    expect(combined?.total_credits_available).toBe(today + target)
    expect(isFoodAnalysisCreditExhausted(combined)).toBe(false)
  })

  it('counts shared earned credits only once', () => {
    const combined = getFoodAnalysisCreditStatusForDate(status(0, 1), status(0, 1), true)
    expect(combined?.total_credits_available).toBe(1)
    expect(isFoodAnalysisCreditExhausted(combined)).toBe(true)
  })

  it('uses only today for a same-day record', () => {
    const today = status(1)
    const combined = getFoodAnalysisCreditStatusForDate(today, status(20), false)
    expect(combined).toBe(today)
    expect(isFoodAnalysisCreditExhausted(combined)).toBe(true)
  })

  it('enforces the actual precision cost against the combined total', () => {
    const combined = getFoodAnalysisCreditStatusForDate(status(1), status(2), true)
    expect(isFoodAnalysisCreditExhausted(combined, 'standard')).toBe(false)
    expect(isFoodAnalysisCreditExhausted(combined, 'strict')).toBe(true)
  })

  it.each([null, { daily_credits_remaining: 0 }, { total_credits_available: 0, earned_credits_balance: NaN }])(
    'does not prematurely block when target credit metadata is missing: %j', target => {
      const combined = getFoodAnalysisCreditStatusForDate(status(0), target as MembershipStatus | null, true)
      expect(combined).toBeNull()
      expect(isFoodAnalysisCreditExhausted(combined)).toBe(false)
    },
  )

  it('can derive system remainder from a total with an explicit reward balance', () => {
    const legacy = { ...status(1, 2), system_credits_remaining: undefined }
    const combined = getFoodAnalysisCreditStatusForDate(legacy, status(2, 2), true)
    expect(combined?.system_credits_remaining).toBe(3)
    expect(combined?.total_credits_available).toBe(5)
  })
})
