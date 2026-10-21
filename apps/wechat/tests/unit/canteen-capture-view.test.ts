import {
  formatYuan,
  itemPriceText,
  itemStatusLabel,
  orderCaptureItems,
  photoProgress,
  rewardHeadline,
  submitBlocker,
} from '../../src/packageExtra/pages/canteen-capture/capture-view'
import type { CaptureItem, CaptureReward, CaptureSessionView } from '../../src/utils/canteen-capture-api'

const item = (patch: Partial<CaptureItem>): CaptureItem => ({
  key: patch.name || 'k', kind: 'dish', name: '菜', status: 'passed', source: 'model', dish_photo_urls: [], ...patch,
})

const reward = (patch: Partial<CaptureReward>): CaptureReward => ({
  status: 'eligible', amount_cents: 0, rates_published: true, photo_tier: 'none', sellable_items: 1, photo_items: 0, message: '', ...patch,
})

const view = (status: CaptureSessionView['session']['status'], menu: boolean, items: CaptureItem[]): CaptureSessionView => ({
  session: {
    id: 's', venue_type: 'university', organization_name: '学校', canteen_name: '一食堂', window_name: '面', service_mode: 'unknown',
    status, exception_status: 'none', menu_item_count: 0, published_item_count: 0, exception_item_count: 0, photo_item_count: 0,
  },
  assets: menu ? [{ id: 'a', session_id: 's', kind: 'menu' }] : [],
  items,
  reward: reward({}),
})

describe('canteen capture view helpers', () => {
  it('formats fen as yuan and never shows negatives', () => {
    expect(formatYuan(300)).toBe('3.00')
    expect(formatYuan(5)).toBe('0.05')
    expect(formatYuan(-1)).toBe('0.00')
  })

  it('only shows units the menu actually wrote', () => {
    expect(itemPriceText(item({ prices: [2.5] }))).toBe('2.5 元')
    expect(itemPriceText(item({ prices: [3], price_unit: '两' }))).toBe('3 元/两')
    expect(itemPriceText(item({ prices: [5, 8, 15] }))).toBe('5 / 8 / 15 元')
    expect(itemPriceText(item({ prices: [] }))).toBe('价格未标')
  })

  it('labels ingredient prices apart from dishes', () => {
    expect(itemStatusLabel(item({ kind: 'ingredient' }))).toBe('配菜价格')
    expect(itemStatusLabel(item({ status: 'exception' }))).toBe('待核对')
    expect(itemStatusLabel(item({ status: 'published' }))).toBe('已上线')
  })

  it('counts photo progress over sellable items only', () => {
    const items = [
      item({ name: 'a', dish_photo_urls: ['u'] }),
      item({ name: 'b' }),
      item({ name: 'c', kind: 'ingredient' }),
      item({ name: 'd', status: 'discarded' }),
    ]
    expect(photoProgress(items)).toEqual({ sellable: 2, photographed: 1 })
  })

  it('puts dishes still missing a photo first and ingredients last', () => {
    const ordered = orderCaptureItems([
      item({ name: 'photographed', dish_photo_urls: ['u'] }),
      item({ name: 'ingredient', kind: 'ingredient' }),
      item({ name: 'missing' }),
    ])
    expect(ordered.map(entry => entry.name)).toEqual(['missing', 'photographed', 'ingredient'])
  })

  it('explains the reward state without promising unannounced amounts', () => {
    expect(rewardHeadline(reward({ status: 'eligible', amount_cents: 300 }))).toBe('预计可得 ¥3.00')
    expect(rewardHeadline(reward({ status: 'eligible', rates_published: false }))).toBe('奖励资格可领取')
    expect(rewardHeadline(reward({ status: 'confirmed', amount_cents: 500 }))).toBe('已获得 ¥5.00')
    expect(rewardHeadline(reward({ status: 'window_taken' }))).toBe('该窗口奖励已被领取')
  })

  it('requires recognition before submitting menu photos', () => {
    expect(submitBlocker(view('draft', true, []))).toBe('needs_extract')
    expect(submitBlocker(view('extracting', true, []))).toBe('extracting')
    expect(submitBlocker(view('extracted', true, [item({})]))).toBe('')
    expect(submitBlocker(view('draft', false, [item({ source: 'collector' })]))).toBe('')
    expect(submitBlocker(view('draft', false, []))).toBe('empty')
    expect(submitBlocker(view('submitted', true, [item({})]))).toBe('submitted')
  })
})
