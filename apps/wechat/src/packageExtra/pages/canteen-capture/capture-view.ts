import type {
  CaptureItem,
  CaptureReward,
  CaptureServiceMode,
  CaptureSessionView,
  CaptureVenueType,
} from '../../../utils/canteen-capture-api'

export const VENUE_OPTIONS: Array<{ value: CaptureVenueType; label: string; organization: string }> = [
  { value: 'university', label: '校园食堂', organization: '学校' },
  { value: 'community', label: '社区食堂', organization: '社区' },
  { value: 'office_park', label: '园区食堂', organization: '园区' },
  { value: 'corporate', label: '公司食堂', organization: '公司' },
]

/** 窗口类型由采集员现场一眼判断；自选窗口的低价条目会作为配菜价格保存。 */
export const SERVICE_MODE_OPTIONS: Array<{ value: CaptureServiceMode; label: string }> = [
  { value: 'fixed_portion', label: '点菜' },
  { value: 'combo', label: '套餐' },
  { value: 'self_select', label: '自选·麻辣烫·称重' },
  { value: 'unknown', label: '不确定' },
]

export function formatYuan(cents: number): string {
  const value = Math.max(0, Number(cents) || 0) / 100
  return value.toFixed(2)
}

export function rewardHeadline(reward: CaptureReward | undefined): string {
  if (!reward) return ''
  switch (reward.status) {
    case 'confirmed':
      return `已获得 ¥${formatYuan(reward.amount_cents)}`
    case 'eligible':
      return reward.rates_published ? `预计可得 ¥${formatYuan(reward.amount_cents)}` : '奖励资格可领取'
    case 'rate_pending':
      return '奖励资格已记录'
    case 'window_taken':
      return '该窗口奖励已被领取'
    case 'rejected':
      return '本次不计奖励'
    default:
      return '还没有可计奖励的菜品'
  }
}

export function itemStatusLabel(item: CaptureItem): string {
  switch (item.status) {
    case 'published':
      return '已上线'
    case 'passed':
      return item.kind === 'ingredient' ? '配菜价格' : '已识别'
    case 'kept':
      return '配菜价格'
    case 'exception':
      return '待核对'
    case 'discarded':
      return '已忽略'
    default:
      return ''
  }
}

/** 只展示菜单上写了的价格和单位；未写单位时不补“份”。 */
export function itemPriceText(item: CaptureItem): string {
  const prices = (item.prices || []).filter(price => Number.isFinite(price))
  if (!prices.length) return '价格未标'
  const unit = item.price_unit ? `/${item.price_unit}` : ''
  return `${prices.map(price => String(price)).join(' / ')} 元${unit}`
}

export function isSellable(item: CaptureItem): boolean {
  return item.kind !== 'ingredient' && item.status !== 'discarded' && item.status !== 'kept'
}

export function photoProgress(items: CaptureItem[]): { sellable: number; photographed: number } {
  const sellable = items.filter(isSellable)
  return { sellable: sellable.length, photographed: sellable.filter(item => (item.dish_photo_urls || []).length > 0).length }
}

/** 可点菜品在前、配菜价格在后；未拍实物的排在已拍之前，方便逐个补拍。 */
export function orderCaptureItems(items: CaptureItem[]): CaptureItem[] {
  const rank = (item: CaptureItem) => (isSellable(item) ? 0 : 2) + ((item.dish_photo_urls || []).length ? 1 : 0)
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item)
}

export function hasMenuPhoto(view: CaptureSessionView | null): boolean {
  return !!view?.assets.some(asset => asset.kind === 'menu')
}

export type SubmitBlocker = '' | 'extracting' | 'needs_extract' | 'empty' | 'submitted'

/** 提交前置条件：有菜单照片就必须先识别完成；没有菜单时至少要有一张写了菜名的实物照。 */
export function submitBlocker(view: CaptureSessionView | null): SubmitBlocker {
  if (!view) return 'empty'
  const status = view.session.status
  if (status === 'submitted') return 'submitted'
  if (status === 'extracting') return 'extracting'
  if (hasMenuPhoto(view) && status !== 'extracted') return 'needs_extract'
  if (!view.items.length) return 'empty'
  return ''
}

export const SUBMIT_BLOCKER_TEXT: Record<Exclude<SubmitBlocker, ''>, string> = {
  extracting: '菜单还在识别，请稍候',
  needs_extract: '请先识别菜单',
  empty: '请先拍菜单，或给实物照写上菜名',
  submitted: '这个窗口已提交',
}

export const CAPTURE_POLL_INTERVAL_MS = 3000
export const CAPTURE_POLL_MAX_ATTEMPTS = 80
