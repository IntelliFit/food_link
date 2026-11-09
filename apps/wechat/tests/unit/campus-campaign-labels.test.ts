import { chinaDayOf, chinaToday, closedNote, formatChinaDay, isoMs, joinCodeFrom } from '../../src/packageResearch/pages/campus-campaign/labels'

describe('campus campaign page helpers', () => {
  it('reads the join code from a share link or a mini program code scene', () => {
    expect(joinCodeFrom({ code: 'abc234' })).toBe('ABC234')
    expect(joinCodeFrom({ scene: encodeURIComponent('XYZ789') })).toBe('XYZ789')
    expect(joinCodeFrom({ code: 'bad code!' })).toBe('')
    expect(joinCodeFrom({})).toBe('')
  })

  it('uses the Beijing date for weighing days', () => {
    // 2026-11-06 20:30 UTC is already 11-07 in Beijing.
    expect(chinaToday(Date.UTC(2026, 10, 6, 20, 30))).toBe('2026-11-07')
    expect(chinaToday(Date.UTC(2026, 10, 6, 3, 0))).toBe('2026-11-06')
  })

  it('shows campaign dates in Beijing time whatever zone the server uses', () => {
    // Beijing midnight on 11-09, written by a UTC or a UTC-5 server.
    expect(chinaDayOf('2026-11-08T16:00:00Z')).toBe('2026-11-09')
    expect(chinaDayOf('2026-11-08T11:00:00-05:00')).toBe('2026-11-09')
    expect(formatChinaDay('2026-12-06T15:59:00Z')).toBe('12月06日')
  })

  it('parses server times without new Date(string), which some iOS versions reject', () => {
    const beijingMidnight = Date.UTC(2026, 10, 8, 16, 0)
    expect(isoMs('2026-11-08T16:00:00Z')).toBe(beijingMidnight)
    expect(isoMs('2026-11-08T11:00:00-05:00')).toBe(beijingMidnight)
    expect(isoMs('2026-11-09T00:00:00.56831+08:00')).toBe(beijingMidnight)
    expect(isoMs('2026-11-09 00:00:00')).toBe(beijingMidnight)
    expect(Number.isNaN(isoMs('soon'))).toBe(true)
    expect(chinaDayOf('soon')).toBe('soon')
  })

  it('says when a campaign starts instead of calling it ended', () => {
    const now = Date.UTC(2026, 10, 8, 12, 0)
    expect(closedNote({ status: 'active', starts_at: '2026-11-09T16:00:00Z' }, now)).toBe('活动11月10日开始，到时再来加入')
    expect(closedNote({ status: 'active', starts_at: '2026-11-01T00:00:00Z' }, now)).toBe('活动已结束')
    expect(closedNote({ status: 'ended', starts_at: '2026-11-09T16:00:00Z' }, now)).toBe('活动已结束')
  })
})
