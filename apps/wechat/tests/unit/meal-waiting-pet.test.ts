import { mealWaitText } from '../../src/pages/index/components/meal-wait-steps'
import { petDisplayName } from '../../src/utils/pet-name'

describe('meal waiting partner', () => {
  it('speaks with the user’s own partner name, and 健文伙伴 by default', () => {
    expect(mealWaitText('locating', petDisplayName('团子'))).toBe('团子在确认你的位置…')
    expect(mealWaitText('locating', petDisplayName(''))).toBe('健文伙伴在确认你的位置…')
    expect(mealWaitText('locating', petDisplayName(undefined))).not.toContain('小麦')
  })

  it('walks through the server’s real steps in order', () => {
    expect(['searching', 'scoring', 'comparing'].map(stage => mealWaitText(stage as 'searching', '健文伙伴'))).toEqual([
      '在找你附近开着的店…',
      '在算你今天还差多少营养…',
      '在比一比哪几道最合适…',
    ])
  })
})
