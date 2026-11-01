const storage = new Map<string, unknown>()
const mockAuthenticatedRequest = jest.fn()
const mockGetAccessToken = jest.fn()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value) },
    removeStorageSync: (key: string) => { storage.delete(key) },
  },
}))

jest.mock('../../src/utils/api', () => ({
  authenticatedRequest: (...args: unknown[]) => mockAuthenticatedRequest(...args),
  getAccessToken: () => mockGetAccessToken(),
}))

import {
  bindPendingPromoCode,
  normalizePromoCode,
  parsePromoCodeFromLaunchOptions,
  readPendingPromoCode,
  writePendingPromoCode,
} from '../../src/utils/promoter-api'
import {
  commissionLine,
  formatCents,
  formatRate,
  ruleLines,
  sharePath,
  statusCopy,
  withdrawAmount,
  withdrawalLine,
} from '../../src/packagePromoter/pages/center/promoter-view'
import type { PromoterCommission, PromoterWithdrawal } from '../../src/utils/promoter-api'

describe('promo code capture', () => {
  beforeEach(() => {
    storage.clear()
    jest.clearAllMocks()
  })

  it('reads share links and mini-program code scenes, rejecting malformed codes', () => {
    expect(parsePromoCodeFromLaunchOptions({ query: { promo: ' ab12cd34 ' } })).toEqual({ code: 'AB12CD34', source: 'share_link' })
    expect(parsePromoCodeFromLaunchOptions({ query: { scene: encodeURIComponent('pc=XY98ZW76&fi=abc') } })).toEqual({ code: 'XY98ZW76', source: 'qr' })
    expect(parsePromoCodeFromLaunchOptions({ query: { promo: 'bad-code' } }).code).toBe('')
    expect(parsePromoCodeFromLaunchOptions({ query: { fi: 'ABCDEFGH' } }).code).toBe('')
    expect(normalizePromoCode('ABC')).toBe('')
  })

  it('keeps the first code a device arrived with and expires it after two days', () => {
    writePendingPromoCode('FIRST111', 'share_link')
    writePendingPromoCode('SECOND22', 'qr')
    expect(readPendingPromoCode()?.code).toBe('FIRST111')

    const stale = JSON.stringify({ code: 'FIRST111', source: 'share_link', createdAt: Date.now() - 49 * 60 * 60 * 1000 })
    storage.set('pending_promo_code_v1', stale)
    expect(readPendingPromoCode()).toBeNull()
    expect(storage.has('pending_promo_code_v1')).toBe(false)
  })

  it('binds only when logged in, clears on a definite answer and keeps the code after a network error', async () => {
    writePendingPromoCode('FIRST111', 'qr')
    mockGetAccessToken.mockReturnValue('')
    expect(await bindPendingPromoCode()).toBe('')
    expect(mockAuthenticatedRequest).not.toHaveBeenCalled()

    mockGetAccessToken.mockReturnValue('token')
    mockAuthenticatedRequest.mockRejectedValueOnce(new Error('timeout'))
    expect(await bindPendingPromoCode()).toBe('')
    expect(readPendingPromoCode()?.code).toBe('FIRST111')

    mockAuthenticatedRequest.mockResolvedValueOnce({ data: { bound: false, reason: 'not_new_user' } })
    expect(await bindPendingPromoCode()).toBe('not_new_user')
    expect(mockAuthenticatedRequest).toHaveBeenLastCalledWith('/api/promoter/bind', expect.objectContaining({
      method: 'POST', data: { promo_code: 'FIRST111', source: 'qr' },
    }))
    expect(readPendingPromoCode()).toBeNull()
  })
})

describe('promoter center view helpers', () => {
  const commission = (patch: Partial<PromoterCommission>): PromoterCommission => ({
    id: 'c1', invitee_nickname: '小**', plan_code: 'light_monthly', order_amount_cents: 1990, rate_bps: 2000,
    commission_cents: 398, status: 'available', paid_at: '2026-11-01T10:00:00+08:00', settle_at: '2026-11-08T10:00:00+08:00',
    ...patch,
  })

  it('formats signed amounts and rates', () => {
    expect(formatCents(398)).toBe('3.98')
    expect(formatCents(-120)).toBe('-1.20')
    expect(formatRate(2000)).toBe('20%')
    expect(formatRate(1250)).toBe('12.5%')
  })

  it('describes commissions by status and dims refunded ones', () => {
    const settled = commissionLine(commission({}))
    expect(settled).toMatchObject({ title: '小** 开通会员', amount: '+¥3.98', status: '已结算', muted: false })
    expect(settled.sub).toContain('实付 ¥19.90 × 20%')
    expect(commissionLine(commission({ status: 'pending' })).status).toContain('可结算')
    expect(commissionLine(commission({ status: 'reversed' }))).toMatchObject({ amount: '¥3.98', status: '订单退款，已扣回', muted: true })
  })

  it('states the agreed rules with the live rate and freeze period', () => {
    const lines = ruleLines({ rate_bps: 2000, settle_delay_days: 7 })
    expect(lines.join('\n')).toContain('按 20% 计算佣金')
    expect(lines.join('\n')).toContain('订单支付 7 天后')
  })

  it('explains each non-active state and shares the home page with the code', () => {
    expect(statusCopy('rejected', '请补充推广渠道')?.body).toContain('请补充推广渠道')
    expect(statusCopy('active')).toBeNull()
    expect(sharePath('AB12CD34')).toBe('/pages/index/index?promo=AB12CD34')
  })
})

describe('withdrawal view helpers', () => {
  const limits = { withdraw_min_cents: 1000, withdraw_max_cents: 20000 }
  const withdrawal = (patch: Partial<PromoterWithdrawal>): PromoterWithdrawal => ({
    id: 'w1', amount_cents: 3000, net_amount_cents: 3000, status: 'reviewing', note: '',
    created_at: '2026-11-01T10:00:00+08:00', ...patch,
  })

  it('withdraws the whole balance capped at the single limit, nothing below the minimum', () => {
    expect(withdrawAmount(limits, 3000)).toBe(3000)
    expect(withdrawAmount(limits, 25000)).toBe(20000)
    expect(withdrawAmount(limits, 999)).toBe(0)
    expect(withdrawAmount(limits, -500)).toBe(0)
  })

  it('labels withdrawals and shows why one was returned', () => {
    expect(withdrawalLine(withdrawal({}))).toMatchObject({ amount: '¥30.00', status: '审核中', muted: false })
    expect(withdrawalLine(withdrawal({ status: 'succeeded', finished_at: '2026-11-03T09:05:00+08:00' })).sub).toContain('到账于')
    expect(withdrawalLine(withdrawal({ status: 'failed', note: '收款账户异常' }))).toMatchObject({
      sub: '收款账户异常，金额已退回余额', status: '打款失败', muted: true,
    })
    expect(withdrawalLine(withdrawal({
      status: 'transferring', note: '请点「收款」', receive: { mch_id: 'm', app_id: 'a', package: 'p' },
    }))).toMatchObject({ sub: '请点「收款」', status: '待收款', muted: false })
    expect(withdrawalLine(withdrawal({ status: 'transferring', note: '微信转账处理中' })).status).toBe('转账中')
  })
})
