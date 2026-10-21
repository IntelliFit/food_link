import { ledgerLine, parseWithdrawCents, rulesText, sessionLine } from '../../src/packageExtra/pages/canteen-earnings/earnings-view'
import type { CaptureEarnings, CaptureSession } from '../../src/utils/canteen-capture-api'

const earnings = (patch: Partial<CaptureEarnings>): CaptureEarnings => ({
  totals: { earned_cents: 0, spent_cents: 0, withdrawing_cents: 0, withdrawn_cents: 0, available_cents: 0, rate_pending_windows: 0, reward_windows: 0 },
  rates_published: true, window_cents: 300, photo_half_cents: 100, photo_full_cents: 200, withdraw_min_cents: 1000,
  membership_options: [], entries: [], sessions: [], session_total: 0, ...patch,
})

const session = (patch: Partial<CaptureSession>): CaptureSession => ({
  id: 's', venue_type: 'university', organization_name: '学校', canteen_name: '一食堂', window_name: '面', service_mode: 'unknown',
  status: 'submitted', exception_status: 'none', menu_item_count: 0, published_item_count: 0, exception_item_count: 0, photo_item_count: 0,
  ...patch,
})

describe('canteen earnings view helpers', () => {
  it('states the published rules and never invents amounts before they are set', () => {
    expect(rulesText(earnings({}))).toEqual([
      '每个新窗口 ¥3.00（同一窗口只奖励第一位提交者）',
      '一半以上的菜有实物图，再加 ¥1.00',
      '每道菜都有实物图，再加 ¥2.00',
    ])
    expect(rulesText(earnings({ rates_published: false }))[0]).toContain('即将公布')
  })

  it('signs ledger amounts and explains non-final states', () => {
    expect(ledgerLine({ id: '1', entry_type: 'window_reward', status: 'confirmed', amount_cents: 300 })).toEqual({ title: '窗口奖励', amount: '+¥3.00', status: '' })
    expect(ledgerLine({ id: '2', entry_type: 'withdrawal', status: 'requested', amount_cents: -1000 })).toEqual({ title: '提现', amount: '-¥10.00', status: '审核中' })
    expect(ledgerLine({ id: '3', entry_type: 'window_reward', status: 'rate_pending', amount_cents: 0 }).status).toBe('金额待公布')
  })

  it('summarises a submitted window and invites resuming a draft', () => {
    expect(sessionLine(session({ published_item_count: 12, exception_status: 'pending', exception_item_count: 2, photo_item_count: 5 })))
      .toBe('上线 12 道 · 2 道核对中 · 5 道有实物图')
    expect(sessionLine(session({ status: 'extracted' }))).toBe('未提交，点此继续')
  })

  it('converts yuan input to fen within the available balance', () => {
    expect(parseWithdrawCents('12.34', 5000)).toBe(1234)
    expect(parseWithdrawCents('60', 5000)).toBe(0)
    expect(parseWithdrawCents('abc', 5000)).toBe(0)
    expect(parseWithdrawCents('-1', 5000)).toBe(0)
  })
})
