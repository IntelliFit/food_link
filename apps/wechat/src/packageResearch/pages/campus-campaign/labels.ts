import type { CampaignRole, CampaignStation, CampusCampaign } from '../../../utils/campus-campaign-api'
import type { ResearchSample } from '../../../utils/research-weight-api'
import { checkDraft, draftHasContent, type ResearchDraft } from '../research-weight/model'

export const MEAL_LABELS: Record<CampaignStation['meal_period'], string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', other: '加餐' }
export const ROLE_LABELS: Record<CampaignRole, string> = { leader: '活动负责人', core: '核心成员', member: '成员' }

/** 北京时间的今天（YYYY-MM-DD），称重日按这个日期排。 */
export function chinaToday(now = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))?$/

/**
 * 接口时间（2026-11-08T16:00:00.123-05:00）转毫秒。不用 new Date(字符串)：
 * 部分 iOS 解析不了带时区的写法。没写时区的按北京时间算。
 */
export function isoMs(iso: string): number {
  const m = ISO_TIME.exec(String(iso || '').trim())
  if (!m) return NaN
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  if (m[7] === 'Z') return wall
  const offsetMinutes = m[7] ? (m[8] === '-' ? -1 : 1) * (+m[9] * 60 + +m[10]) : 8 * 60
  return wall - offsetMinutes * 60000
}

/** 接口时间转北京日期（YYYY-MM-DD）：服务器时区不同也不会差一天。 */
export function chinaDayOf(iso: string): string {
  const at = isoMs(iso)
  return Number.isNaN(at) ? String(iso || '').slice(0, 10) : chinaToday(at)
}

/** 页面上的日期：11月09日。 */
export function formatChinaDay(iso: string): string {
  const day = chinaDayOf(iso)
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`
}

/** 不在进行中的活动：还没开始的说哪天开始，过了的说已结束。 */
export function closedNote(campaign: Pick<CampusCampaign, 'status' | 'starts_at'>, now = Date.now()): string {
  const startsAt = isoMs(campaign.starts_at)
  if (campaign.status === 'active' && now < startsAt) return `活动${formatChinaDay(campaign.starts_at)}开始，到时再来加入`
  return '活动已结束'
}

/** 称重页「先保存，吃完再来」之后，活动页的按钮要能接着称。 */
export function scaleButtonLabel(draft: ResearchDraft): string {
  if (!draftHasContent(draft)) return '用秤记一顿'
  return checkDraft(draft, {}).waitingForMeal ? '继续：吃完称空盒' : '继续记这一顿'
}

/** 计入活动的称重（自己称、称重日、同菜多份），个人科研计划的不算。 */
export function isCampaignWeighing(sample: Pick<ResearchSample, 'collection_channel'>): boolean {
  return String(sample.collection_channel || '').startsWith('campus_')
}

/** 一次称重的结果，一整串文字：多少克、审核到哪一步、加了多少分。 */
export function weighingResult(sample: Pick<ResearchSample, 'status' | 'quality_tier' | 'reward_credits' | 'review_note' | 'total_net_grams'>): string {
  const grams = `${sample.total_net_grams}g`
  if (sample.status === 'pending') return `${grams} · 自动审核中，几秒出结果`
  if (sample.status === 'rejected') return `${grams} · ${sample.review_note || '没通过'}`
  const tier = sample.quality_tier ? `${sample.quality_tier} 级` : '已通过'
  if (sample.reward_credits > 0) return `${grams} · ${tier} · +${sample.reward_credits} 积分`
  if (sample.review_note.includes('不再计分')) return `${grams} · ${tier} · 今天加分的份数已满`
  return `${grams} · ${tier} · 不加分`
}

/** 扫小程序码进来时加入码在 scene 里，分享链接里是 code。 */
export function joinCodeFrom(params: Record<string, string | undefined>): string {
  const raw = params.code || (params.scene ? decodeURIComponent(params.scene) : '')
  const code = String(raw || '').trim().toUpperCase()
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : ''
}
