import { canteenHint, chosenSummary, dishesForWindow, isAnswering, parsePriceInput, stepOf } from '../../src/components/MealDishPrompt/meal-dish-state'
import type { MealDishItem, MealDishView } from '../../src/utils/meal-dish-api'

const prompt = (patch: Record<string, unknown> = {}) => ({
  id: 'p', analysis_task_id: 't', surface: 'wait', gap_kind: 'none', reward_credits: 0, ...patch,
}) as MealDishView['prompt']

const view = (patch: Partial<MealDishView>): MealDishView => ({ eligible: true, canteens: [], ...patch })

const dish = (id: string, window: string): MealDishItem => ({ id, name: id, window_name: window, price_text: '', has_real_photo: false })

describe('meal dish prompt state', () => {
  it('walks canteen, dish, photo, done', () => {
    expect(stepOf(null, false)).toBe('hidden')
    expect(stepOf(view({ eligible: false }), true)).toBe('offer')
    expect(stepOf(view({ eligible: false }), false)).toBe('hidden')
    expect(stepOf(view({ prompt: prompt() }), false)).toBe('canteen')
    expect(stepOf(view({ prompt: prompt({ chosen_canteen_id: 'c' }) }), false)).toBe('dish')
    expect(stepOf(view({ prompt: prompt({ chosen_canteen_id: 'c', chosen_item_id: 'd', gap_kind: 'photo' }) }), false)).toBe('photo')
    expect(stepOf(view({ prompt: prompt({ chosen_item_id: 'd', gap_kind: 'photo', photo_consent: false }) }), false)).toBe('done')
    expect(stepOf(view({ prompt: prompt({ chosen_item_id: 'd' }) }), false)).toBe('done')
    expect(stepOf(view({ prompt: prompt({ skipped_at: 'now' }) }), false)).toBe('hidden')
  })

  it('offers the home recommendation first and asks the price after the photo', () => {
    const recommended = { id: 'd', name: '炸鸡饭', window_name: '中式套餐', price_text: '8元', has_real_photo: false }
    expect(stepOf(view({ prompt: prompt(), recommended_dish: recommended }), false)).toBe('recommended')
    expect(stepOf(view({ prompt: prompt(), recommended_dish: recommended }), false, true)).toBe('canteen')
    expect(stepOf(view({ prompt: prompt({ chosen_canteen_id: 'c' }), recommended_dish: recommended }), false)).toBe('dish')

    const ask = { current_price: 12, price_text: '12元' }
    const asked = { chosen_item_id: 'd', price_asked_at: 'now' }
    expect(stepOf(view({ prompt: prompt(asked), price_ask: ask }), false)).toBe('price')
    expect(stepOf(view({ prompt: prompt({ ...asked, gap_kind: 'photo' }), price_ask: ask }), false)).toBe('photo')
    expect(stepOf(view({ prompt: prompt({ ...asked, price_answer_kind: 'skipped' }) }), false)).toBe('done')
  })

  it('reads the price input', () => {
    expect(parsePriceInput('12')).toBe(12)
    expect(parsePriceInput(' 12.345 ')).toBe(12.35)
    expect(parsePriceInput('0')).toBeNull()
    expect(parsePriceInput('600')).toBeNull()
    expect(parsePriceInput('abc')).toBeNull()
  })

  it('holds the redirect only while the user is answering', () => {
    expect(isAnswering('dish')).toBe(true)
    expect(isAnswering('photo')).toBe(true)
    expect(isAnswering('price')).toBe(true)
    expect(isAnswering('recommended')).toBe(false)
    expect(isAnswering('canteen')).toBe(false)
    expect(isAnswering('done')).toBe(false)
  })

  it('shows four dishes of the chosen window, twelve when expanded', () => {
    const dishes = [...Array.from({ length: 14 }, (_, i) => dish(`s${i}`, '上海风味')), dish('x', '东南亚风味'), dish('y', '')]
    expect(dishesForWindow(dishes, '上海风味', false).map(d => d.id)).toEqual(['s0', 's1', 's2', 's3'])
    expect(dishesForWindow(dishes, '上海风味', true)).toHaveLength(12)
    expect(dishesForWindow(dishes, '其他窗口', false).map(d => d.id)).toEqual(['y'])
  })

  it('summarises the linked dish and falls back for missing reasons', () => {
    const linked = view({
      chosen_canteen: { id: 'c', name: '紫荆园', school_name: '清华大学', reason: 'nearby', reason_text: '', dish_count: 10 },
      chosen_dish: { id: 'd', name: '手工虾仁烧麦', window_name: '上海风味', price_text: '15元', has_real_photo: false },
    })
    expect(chosenSummary(linked)).toBe('紫荆园 · 上海风味 · 手工虾仁烧麦 · 15元')
    expect(chosenSummary(view({}))).toBe('')
    expect(canteenHint('定位 · 距你 30 m', 10)).toBe('定位 · 距你 30 m')
    expect(canteenHint('', 12)).toBe('12 道菜')
    expect(canteenHint('', 0)).toBe('')
  })
})
