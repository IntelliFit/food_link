import { personalOpening, recordGuessChoices, recapSwipeTarget, storyMemories } from '../../src/utils/recap-story'
import type { RecapDay } from '../../src/utils/health-recap'

test('monthly journey includes the end of a 31-day month without discarding records', () => {
  const days: RecapDay[] = Array.from({ length: 31 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, has_record: i === 30, calories: 0 }))
  const memories = storyMemories(days, 'month')
  expect(memories).toHaveLength(5)
  expect(memories[4].count).toBe(1)
  expect(memories.flatMap(row => row.dates)).toEqual(days)
})
test('sparse and empty narratives describe actual dates without inventing a habit', () => {
  expect(personalOpening([], 0)).toContain('留白')
  expect(personalOpening([{ date: '2026-09-08', has_record: true, calories: 1200 }], 1)).toContain('9月8日')
})


test('guess choices contain the real answer once and stay inside the period', () => {
  for (let total = 1; total <= 31; total++) for (let count = 0; count <= total; count++) {
    const choices = recordGuessChoices(count, total)
    expect(choices.filter(value => value === count)).toHaveLength(1)
    expect(choices.every(value => value >= 0 && value <= total)).toBe(true)
    expect(new Set(choices).size).toBe(choices.length)
  }
})


test('first viewing advances upward only, review unlocks backward travel, small and horizontal gestures do not turn pages', () => {
  expect(recapSwipeTarget(2, false, 0, -100, 6)).toBe(3)
  expect(recapSwipeTarget(2, false, 0, 100, 6)).toBe(2)
  expect(recapSwipeTarget(2, true, 0, 100, 6)).toBe(1)
  expect(recapSwipeTarget(2, false, 120, -100, 6)).toBe(2)
  expect(recapSwipeTarget(2, false, 0, -40, 6)).toBe(2)
  expect(recapSwipeTarget(5, true, 0, -100, 6)).toBe(5)
  expect(recapSwipeTarget(0, true, 0, 100, 6)).toBe(0)
})
