import type { CampaignRole, CampaignStation } from '../../../utils/campus-campaign-api'

export const MEAL_LABELS: Record<CampaignStation['meal_period'], string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', other: '加餐' }
export const ROLE_LABELS: Record<CampaignRole, string> = { leader: '活动负责人', core: '核心成员', member: '成员' }

/** 北京时间的今天（YYYY-MM-DD），称重日按这个日期排。 */
export function chinaToday(now = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 扫小程序码进来时加入码在 scene 里，分享链接里是 code。 */
export function joinCodeFrom(params: Record<string, string | undefined>): string {
  const raw = params.code || (params.scene ? decodeURIComponent(params.scene) : '')
  const code = String(raw || '').trim().toUpperCase()
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : ''
}
