import {
  extractManualFoodDisplayItems,
  isManualFoodFeedRecord,
  manualFoodSourceLabel
} from '../../src/utils/manual-food-source'

describe('manual-food-source', () => {
  it('maps manual_source to display labels', () => {
    expect(manualFoodSourceLabel('nutrition_library')).toBe('常用食物')
    expect(manualFoodSourceLabel('packaged_food')).toBe('包装食品')
    expect(manualFoodSourceLabel('public_library')).toBe('真实餐食')
    expect(manualFoodSourceLabel('nutrition_library', '自定义')).toBe('自定义')
  })

  it('does not treat photo recognition items as manual', () => {
    expect(
      isManualFoodFeedRecord({
        description: '午餐：鸡胸肉、米饭',
        items: [{ name: '鸡胸肉', nutrients: { calories: 200 } }]
      })
    ).toBe(false)
    expect(extractManualFoodDisplayItems([{ name: '鸡胸肉', nutrients: { calories: 200 } }])).toHaveLength(0)
  })

  it('detects manual feed by description or manual_source', () => {
    expect(isManualFoodFeedRecord({ description: '手动记录：白米饭、鸡蛋', items: [] })).toBe(true)
    expect(
      isManualFoodFeedRecord({
        description: 'x',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(true)
  })

  it('extracts manual items with resolved image url', () => {
    const rows = extractManualFoodDisplayItems([
      {
        name: '白米饭',
        manual_source: 'nutrition_library',
        manual_source_title: '白米饭',
        image_path: 'https://cdn.example.com/rice.jpg',
        nutrients: { calories: 228 }
      }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceLabel).toBe('常用食物')
    expect(rows[0].imageUrl).toBe('https://cdn.example.com/rice.jpg')
  })
})
