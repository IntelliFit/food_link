import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import { useEffect } from 'react'
import PromoterCenterPage from '../../src/packagePromoter/pages/center/index'
import {
  applyPromoter,
  createPromoterWithdrawal,
  getPromoterCommissions,
  getPromoterMe,
  getPromoterWithdrawals,
  refreshPromoterWithdrawal,
} from '../../src/utils/promoter-api'
import type { PromoterMe } from '../../src/utils/promoter-api'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, openType, ...props }: any) => React.createElement('button', { ...props, 'data-open-type': openType }, children),
    Textarea: ({ onInput, ...props }: any) => React.createElement('textarea', { ...props, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
    ScrollView: ({ children }: any) => children,
  }
})
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/utils/api', () => ({ showUnifiedApiError: jest.fn() }))
jest.mock('../../src/utils/promoter-api', () => ({
  getPromoterMe: jest.fn(), applyPromoter: jest.fn(), getPromoterCommissions: jest.fn(),
  getPromoterWithdrawals: jest.fn(), createPromoterWithdrawal: jest.fn(), refreshPromoterWithdrawal: jest.fn(),
}))

const base: PromoterMe = {
  enabled: true, status: 'none', rate_bps: 2000, agreement_version: 'v1', settle_delay_days: 7,
  withdraw_min_cents: 1000, withdraw_max_cents: 20000,
}
const summary = (patch: Partial<NonNullable<PromoterMe['summary']>> = {}) => ({
  available_cents: 398, pending_cents: 198, total_earned_cents: 398, withdrawing_cents: 0, withdrawn_cents: 0,
  invitee_count: 3, paid_order_count: 2, ...patch,
})

beforeEach(() => {
  jest.clearAllMocks()
  // Taro runs useDidShow after mount; the shared mock calls it during render.
  ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => {
    useEffect(() => { callback() }, [])
  })
})

it('requires agreeing to the rules before applying, then shows the review state', async () => {
  ;(getPromoterMe as jest.Mock).mockResolvedValue(base)
  ;(applyPromoter as jest.Mock).mockResolvedValue({ ...base, status: 'pending_review' })
  render(<PromoterCenterPage />)

  expect(await screen.findByText('推荐食探，赚推广佣金')).toBeTruthy()
  fireEvent.click(screen.getByText('提交申请'))
  expect(applyPromoter).not.toHaveBeenCalled()

  fireEvent.change(screen.getByPlaceholderText(/你打算在哪里推广/), { target: { value: '  健身群  ' } })
  fireEvent.click(screen.getByText(/我已阅读并同意以上推广规则/))
  fireEvent.click(screen.getByText('提交申请'))
  await waitFor(() => expect(applyPromoter).toHaveBeenCalledWith('v1', '健身群'))
  expect(await screen.findByText('申请审核中')).toBeTruthy()
  expect(screen.queryByText('提交申请')).toBeNull()
})

it('shows the promo code, balances and commission list once approved', async () => {
  ;(getPromoterMe as jest.Mock).mockResolvedValue({
    ...base, status: 'active', promo_code: 'AB12CD34', summary: summary(),
  })
  ;(getPromoterWithdrawals as jest.Mock).mockResolvedValue({ total: 0, items: [] })
  ;(getPromoterCommissions as jest.Mock).mockResolvedValue({
    total: 1,
    items: [{ id: 'c1', invitee_nickname: '小**', plan_code: 'light_monthly', order_amount_cents: 1990, rate_bps: 2000, commission_cents: 398, status: 'available', paid_at: '2026-11-01T10:00:00+08:00', settle_at: '2026-11-08T10:00:00+08:00' }],
  })
  render(<PromoterCenterPage />)

  expect(await screen.findByText('AB12CD34')).toBeTruthy()
  expect(screen.getAllByText('¥3.98')).toHaveLength(2) // 可提现 and 累计结算
  expect(screen.getByText('¥1.98')).toBeTruthy()
  expect(screen.getByText('小** 开通会员')).toBeTruthy()
  expect(screen.getByText('分享给好友').getAttribute('data-open-type')).toBe('share')
  expect(getPromoterCommissions).toHaveBeenCalledWith(1, 20)
  expect(screen.queryByText('查看更多')).toBeNull()
  expect(screen.getByText('满 ¥10.00 可提现')).toBeTruthy()
  expect(screen.queryByText('提现记录')).toBeNull()
})

it('withdraws the balance up to the single limit and reuses the request key after a failure', async () => {
  ;(getPromoterMe as jest.Mock).mockResolvedValue({
    ...base, status: 'active', promo_code: 'AB12CD34', summary: summary({ available_cents: 25000, total_earned_cents: 25000 }),
  })
  ;(getPromoterCommissions as jest.Mock).mockResolvedValue({ total: 0, items: [] })
  ;(getPromoterWithdrawals as jest.Mock).mockResolvedValue({
    total: 1,
    items: [{ id: 'w1', amount_cents: 1500, net_amount_cents: 1500, status: 'rejected', note: '请先补充实名信息', created_at: '2026-11-01T10:00:00+08:00' }],
  })
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
  ;(createPromoterWithdrawal as jest.Mock)
    .mockRejectedValueOnce(new Error('timeout'))
    .mockRejectedValueOnce(Object.assign(new Error('上一笔提现还在处理中'), { statusCode: 409 }))
    .mockResolvedValueOnce({ id: 'w2' })
  render(<PromoterCenterPage />)

  expect(await screen.findByText('提现记录')).toBeTruthy()
  expect(screen.getByText('请先补充实名信息，金额已退回余额')).toBeTruthy()
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitFor(() => expect(screen.getByText('提现 ¥200.00')).toBeTruthy())
    fireEvent.click(screen.getByText('提现 ¥200.00'))
    await waitFor(() => expect(createPromoterWithdrawal).toHaveBeenCalledTimes(attempt))
  }
  const [first, second, third] = (createPromoterWithdrawal as jest.Mock).mock.calls
  expect(first[0]).toBe(20000)
  expect(second[1]).toBe(first[1]) // a network failure may have saved it: retry with the same key
  expect(third[1]).not.toBe(second[1]) // the server refused it: nothing was saved, start fresh
  await waitFor(() => expect(getPromoterMe).toHaveBeenCalledTimes(2))
})

it('keeps a suspended promoter from withdrawing', async () => {
  ;(getPromoterMe as jest.Mock).mockResolvedValue({
    ...base, status: 'suspended', promo_code: 'AB12CD34', summary: summary({ available_cents: 5000 }),
  })
  ;(getPromoterCommissions as jest.Mock).mockResolvedValue({ total: 0, items: [] })
  ;(getPromoterWithdrawals as jest.Mock).mockResolvedValue({ total: 0, items: [] })
  render(<PromoterCenterPage />)
  expect(await screen.findByText('暂停期间不能提现，佣金会一直为你保留。')).toBeTruthy()
  expect(screen.queryByText(/^提现 ¥/)).toBeNull()
})

it('lets a rejected applicant see the reason and apply again', async () => {
  ;(getPromoterMe as jest.Mock).mockResolvedValue({ ...base, status: 'rejected', review_note: '请补充推广渠道' })
  render(<PromoterCenterPage />)
  expect(await screen.findByText('申请未通过')).toBeTruthy()
  expect(screen.getByText(/请补充推广渠道/)).toBeTruthy()
  expect(screen.getByText('提交申请')).toBeTruthy()
  expect(getPromoterCommissions).not.toHaveBeenCalled()
})

it('opens the WeChat confirm page for a transfer waiting on the promoter, then refreshes', async () => {
  const requestMerchantTransfer = jest.fn(({ success }: any) => success())
  ;(globalThis as any).wx = { canIUse: () => true, requestMerchantTransfer }
  ;(getPromoterMe as jest.Mock).mockResolvedValue({
    ...base, status: 'active', promo_code: 'AB12CD34', summary: summary({ withdrawing_cents: 3000 }),
  })
  ;(getPromoterCommissions as jest.Mock).mockResolvedValue({ total: 0, items: [] })
  ;(getPromoterWithdrawals as jest.Mock).mockResolvedValue({
    total: 1,
    items: [{
      id: 'w9', amount_cents: 3000, net_amount_cents: 3000, status: 'transferring', note: '请在 24 小时内点「收款」确认',
      receive: { mch_id: '1105991965', app_id: 'wx-mini', package: 'pkg-1' }, created_at: '2026-11-01T10:00:00+08:00',
    }],
  })
  ;(refreshPromoterWithdrawal as jest.Mock).mockResolvedValue({ id: 'w9', status: 'succeeded' })
  try {
    render(<PromoterCenterPage />)
    expect(await screen.findByText('请在 24 小时内点「收款」确认')).toBeTruthy()
    fireEvent.click(screen.getByText('收款'))
    await waitFor(() => expect(refreshPromoterWithdrawal).toHaveBeenCalledWith('w9'))
    expect(requestMerchantTransfer).toHaveBeenCalledWith(expect.objectContaining({ mchId: '1105991965', appId: 'wx-mini', package: 'pkg-1' }))
    await waitFor(() => expect(getPromoterMe).toHaveBeenCalledTimes(2))
  } finally {
    delete (globalThis as any).wx
  }
})
