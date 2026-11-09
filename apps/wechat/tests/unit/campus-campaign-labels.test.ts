import { chinaDayOf, chinaToday, closedNote, formatChinaDay, isCampaignWeighing, isoMs, joinCodeFrom, scaleButtonLabel, weighingResult } from '../../src/packageResearch/pages/campus-campaign/labels'
import { emptyDraft } from '../../src/packageResearch/pages/research-weight/model'

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

  it('offers to continue a weighed meal saved for after eating', () => {
    const draft = emptyDraft(1)
    expect(scaleButtonLabel(draft)).toBe('用秤记一顿')
    const shot = { url: 'https://cdn.test/a.jpg', capturedAt: '2026-11-09T04:00:00.000Z' }
    const waiting = {
      ...draft,
      dishName: '宫保鸡丁',
      photos: { eval_top: shot },
      containers: [{ ...draft.containers[0], name: '米饭', gross: '512', grossPhoto: shot, tareSource: 'after_meal' as const }],
    }
    expect(scaleButtonLabel(waiting)).toBe('继续：吃完称空盒')
    expect(scaleButtonLabel({ ...waiting, containers: [{ ...waiting.containers[0], gross: '' }] })).toBe('继续记这一顿')
  })

  it('shows each campaign weighing with its review result and points', () => {
    const base = { total_net_grams: 832, quality_tier: undefined, reward_credits: 0, review_note: '' }
    expect(weighingResult({ ...base, status: 'pending' })).toBe('832g · 自动审核中，几秒出结果')
    expect(weighingResult({ ...base, status: 'approved', quality_tier: 'B', reward_credits: 3 })).toBe('832g · B 级 · +3 积分')
    expect(weighingResult({ ...base, status: 'approved', quality_tier: 'A', review_note: '今天已满 10 份，不再计分' })).toBe('832g · A 级 · 今天加分的份数已满')
    expect(weighingResult({ ...base, status: 'approved', quality_tier: 'C' })).toBe('832g · C 级 · 不加分')
    expect(weighingResult({ ...base, status: 'rejected', review_note: '照片里看不清秤的读数' })).toBe('832g · 照片里看不清秤的读数')
    expect(isCampaignWeighing({ collection_channel: 'campus_station' })).toBe(true)
    expect(isCampaignWeighing({ collection_channel: 'personal' })).toBe(false)
  })

  it('says when a campaign starts instead of calling it ended', () => {
    const now = Date.UTC(2026, 10, 8, 12, 0)
    expect(closedNote({ status: 'active', starts_at: '2026-11-09T16:00:00Z' }, now)).toBe('活动11月10日开始，到时再来加入')
    expect(closedNote({ status: 'active', starts_at: '2026-11-01T00:00:00Z' }, now)).toBe('活动已结束')
    expect(closedNote({ status: 'ended', starts_at: '2026-11-09T16:00:00Z' }, now)).toBe('活动已结束')
  })
})
