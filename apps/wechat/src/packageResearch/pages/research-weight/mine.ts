import type { ResearchSample } from '../../../utils/research-weight-api'

const MODE_LABELS: Record<string, string> = { multi: '按盒', itemized: '分项', whole: '整份' }

export interface MineRow {
  /** 称法、项数、净重。 */
  meta: string
  /** 通过后的等级和积分，如「B 级 · +3 积分」；未通过或待审核时为空。 */
  reward: string
  /** 审核说明，未通过时告诉用户为什么。 */
  note: string
}

/** 「我的提交」一行要显示的内容：积分单独一行，审核说明完整显示，不再挤在一行里被截断。 */
export function mineRow(item: Pick<ResearchSample, 'weighing_mode' | 'items' | 'total_net_grams' | 'status' | 'quality_tier' | 'reward_credits' | 'review_note'>): MineRow {
  const mode = MODE_LABELS[item.weighing_mode] || item.weighing_mode
  const count = item.items?.length ? ` ${item.items.length} 项` : ''
  let reward = ''
  if (item.status === 'approved') {
    const tier = item.quality_tier ? `${item.quality_tier} 级 · ` : ''
    reward = item.reward_credits > 0 ? `${tier}+${item.reward_credits} 积分` : `${tier}不计分`
  }
  return { meta: `${mode}${count} · ${item.total_net_grams}g`, reward, note: String(item.review_note || '').trim() }
}
