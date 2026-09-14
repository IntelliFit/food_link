import { formatFeedTime } from '../../src/utils/feed-time'

describe('formatFeedTime', () => {
  const now = Date.parse('2026-09-08T14:35:00+08:00')

  it('keeps the exact clock alongside recent relative time', () => {
    expect(formatFeedTime('2026-09-08T14:30:00+08:00', now)).toBe('5分钟前 · 14:30')
    expect(formatFeedTime('2026-09-08T12:35:00+08:00', now)).toBe('2小时前 · 12:35')
  })

  it('treats timezone-less backend timestamps as China time', () => {
    expect(formatFeedTime('2026-09-07 09:06:00', now)).toBe('9月7日 09:06')
  })

  it('includes the year for older interactions', () => {
    expect(formatFeedTime('2025-12-31T23:59:00+08:00', now)).toBe('2025-12-31 23:59')
  })
})
