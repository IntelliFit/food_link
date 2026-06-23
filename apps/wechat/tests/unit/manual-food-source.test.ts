import {
  extractManualFoodDisplayItems,
  isManualFoodFeedRecord,
  manualFoodSourceLabel,
  shouldRenderManualFoodCards
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

  it('only treats legacy manual feed as manual when description prefix and manual items both exist', () => {
    expect(isManualFoodFeedRecord({ description: '手动记录：白米饭、鸡蛋', items: [] })).toBe(false)
    expect(
      isManualFoodFeedRecord({
        description: '手动记录：白米饭',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(true)
  })

  it('prefers entry_type when deciding whether to render manual food cards', () => {
    expect(
      shouldRenderManualFoodCards({
        entry_type: 'food_library',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(true)
    expect(
      shouldRenderManualFoodCards({
        entry_type: 'public_food_library',
        items: [{ name: '香蕉', manual_source: 'public_library', nutrients: { calories: 89 } }]
      })
    ).toBe(true)
    expect(
      shouldRenderManualFoodCards({
        entry_type: 'food_image',
        items: [{ name: '不该显示成库卡', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(false)
    expect(
      shouldRenderManualFoodCards({
        entry_type: 'food_text',
        items: [{ name: '不该显示成库卡', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(false)
    expect(
      shouldRenderManualFoodCards({
        entry_type: 'favorite_recipe',
        items: [{ name: '收藏食谱', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(false)
  })

  it('falls back to legacy manual detection only when entry_type is missing and record is not task/recipe based', () => {
    expect(
      shouldRenderManualFoodCards({
        description: '手动记录：白米饭',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(true)
    expect(
      shouldRenderManualFoodCards({
        source_task_id: 'task-1',
        description: '手动记录：白米饭',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(false)
    expect(
      shouldRenderManualFoodCards({
        recipe_id: 'recipe-1',
        description: '手动记录：白米饭',
        items: [{ name: '白米饭', manual_source: 'nutrition_library', nutrients: { calories: 1 } }]
      })
    ).toBe(false)
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
