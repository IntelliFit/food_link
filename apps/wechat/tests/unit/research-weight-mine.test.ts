import { mineRow } from '../../src/packageResearch/pages/research-weight/mine'

const base = {
  weighing_mode: 'multi' as const,
  items: [{ name: '米饭' }, { name: '卤鸡腿' }] as never[],
  total_net_grams: 760,
  status: 'approved' as const,
  quality_tier: 'B' as const,
  reward_credits: 3,
  review_note: '自动审核通过（B 级）：第1盒连盒读数只有一个模型读出读数',
}

describe('mineRow', () => {
  it('shows the tier and credits of an approved sample next to the weight', () => {
    expect(mineRow(base)).toEqual({ meta: '按盒 2 项 · 760g', reward: 'B 级 · +3 积分', note: base.review_note })
  })

  it('says when an approved sample earns nothing', () => {
    expect(mineRow({ ...base, quality_tier: 'C', reward_credits: 0 }).reward).toBe('C 级 · 不计分')
    expect(mineRow({ ...base, quality_tier: undefined, reward_credits: 0 }).reward).toBe('不计分')
  })

  it('keeps the full rejection reason and no reward for rejected or pending samples', () => {
    const rejected = mineRow({ ...base, status: 'rejected', quality_tier: undefined, reward_credits: 0, review_note: ' 有照片和已提交过的照片完全相同，请重新拍摄 ' })
    expect(rejected).toEqual({ meta: '按盒 2 项 · 760g', reward: '', note: '有照片和已提交过的照片完全相同，请重新拍摄' })
    expect(mineRow({ ...base, status: 'pending', review_note: '' })).toEqual({ meta: '按盒 2 项 · 760g', reward: '', note: '' })
  })

  it('labels itemized samples and omits the count when there are no items', () => {
    expect(mineRow({ ...base, weighing_mode: 'itemized', items: [] }).meta).toBe('分项 · 760g')
  })
})
