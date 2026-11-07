import { chinaToday, joinCodeFrom } from '../../src/packageResearch/pages/campus-campaign/labels'

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
})
