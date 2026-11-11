import {
  buildQuickCorrections,
  isLiquidFoodName,
  quickCorrectionSavedKcal,
} from '../../src/packageExtra/pages/result/quick-corrections'

const meal = [
  { id: 1, name: '米饭', calorie: 255, ratio: 100 },
  { id: 2, name: '农家一碗香', calorie: 361, ratio: 100 },
  { id: 3, name: '例汤', calorie: 39, ratio: 100 },
]

describe('result page quick corrections', () => {
  it('offers the highest-calorie foods first, with 没喝 for soups and drinks', () => {
    expect(buildQuickCorrections(meal).map(chip => chip.label)).toEqual([
      '农家一碗香只吃了一半',
      '米饭只吃了一半',
      '例汤没喝',
    ])
    expect(buildQuickCorrections(meal)[2]).toMatchObject({ itemId: 3, ratio: 0, toast: '例汤去掉了' })
  })

  it('drops a chip once that item is already at or below the target', () => {
    const adjusted = meal.map(item => (item.id === 2 ? { ...item, ratio: 50 } : item.id === 3 ? { ...item, ratio: 0 } : item))
    expect(buildQuickCorrections(adjusted).map(chip => chip.itemId)).toEqual([1])
  })

  it('keeps at most three chips and shortens long names', () => {
    const many = [
      { id: 1, name: '黑椒牛柳意大利面套餐', calorie: 800, ratio: 100 },
      { id: 2, name: '薯条', calorie: 300, ratio: 100 },
      { id: 3, name: '炸鸡', calorie: 500, ratio: 100 },
      { id: 4, name: '可乐', calorie: 200, ratio: 100 },
    ]
    const chips = buildQuickCorrections(many)
    expect(chips).toHaveLength(3)
    expect(chips[0].label).toBe('黑椒牛柳意大…只吃了一半')
  })

  it('skips foods without calories or names', () => {
    expect(buildQuickCorrections([{ id: 1, name: '', calorie: 100, ratio: 100 }, { id: 2, name: '水', calorie: 0, ratio: 100 }])).toEqual([])
  })

  it('works out how many kcal the change removes', () => {
    expect(quickCorrectionSavedKcal(meal[0], 50)).toBe(128)
    expect(quickCorrectionSavedKcal(meal[2], 0)).toBe(39)
    expect(quickCorrectionSavedKcal({ ...meal[0], ratio: 40 }, 50)).toBe(0)
  })

  it('recognises soups and drinks', () => {
    expect(isLiquidFoodName('紫菜蛋花汤')).toBe(true)
    expect(isLiquidFoodName('珍珠奶茶')).toBe(true)
    expect(isLiquidFoodName('宫保鸡丁')).toBe(false)
  })
})
