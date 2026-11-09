import {
  customDraftFromPackagedExtract,
  describeCustomImport,
  isSnackCustomFood,
  pollPackagedExtractResult,
  type CustomImportDeps,
} from '../src/custom-food-import'
import type { PackagedProductExtractResult } from '../src/types'

const chips: PackagedProductExtractResult = {
  brand: '乐事',
  product_name: '薯片',
  flavor_text: '黄瓜味',
  catalog_category: 'snack',
  default_portion_g: 75,
  net_weight_g: 75,
  unit_nutrition_per_100g: {
    calories: 548,
    protein: 6.1,
    carbs: 50.33,
    fat: 35.5,
    fiber: 3,
    sugar: 0,
    sodiumMg: 630,
    vitaminCMg: 12.5,
  },
}

describe('customDraftFromPackagedExtract', () => {
  it('fills the form per 100g in kcal and joins brand, product and flavor', () => {
    const draft = customDraftFromPackagedExtract(chips)

    expect(draft.name).toBe('乐事 薯片 黄瓜味')
    expect(draft.weight).toBe('75')
    expect(draft.category).toBe('snack')
    expect(draft.nutrition).toEqual({
      calories: '548',
      protein: '6.1',
      carbs: '50.33',
      fat: '35.5',
      micro: { fiber: '3', sodium_mg: '630', vitaminCMg: '12.5' },
    })
  })

  it('does not repeat a brand or flavor the product name already contains', () => {
    const draft = customDraftFromPackagedExtract({
      brand: '乐事',
      product_name: '乐事薯片黄瓜味',
      flavor_text: '黄瓜味',
    })

    expect(draft.name).toBe('乐事薯片黄瓜味')
  })

  it('keeps non-snack products in the custom category', () => {
    expect(customDraftFromPackagedExtract({ ...chips, catalog_category: 'dairy' }).category).toBe('custom')
    expect(customDraftFromPackagedExtract({ ...chips, catalog_category: undefined }).category).toBe('custom')
  })

  it('leaves nutrition out when the label calories could not be read', () => {
    const draft = customDraftFromPackagedExtract({
      product_name: '薯片',
      unit_nutrition_per_100g: { calories: 0, protein: 6 },
    })

    expect(draft.name).toBe('薯片')
    expect(draft.nutrition).toBeNull()
  })

  it('falls back to net weight, then leaves weight empty', () => {
    expect(customDraftFromPackagedExtract({ product_name: '薯片', net_weight_g: 104 }).weight).toBe('104')
    expect(customDraftFromPackagedExtract({ product_name: '薯片' }).weight).toBe('')
  })
})

describe('describeCustomImport', () => {
  it('tells the user a snack was filed under snacks and to check the values', () => {
    const note = describeCustomImport(customDraftFromPackagedExtract(chips), chips)

    expect(note).toContain('零食')
    expect(note).toContain('核对')
  })

  it('asks for the nutrition label when calories are missing', () => {
    const result = { product_name: '薯片' }

    expect(describeCustomImport(customDraftFromPackagedExtract(result), result)).toContain('营养成分表')
  })

  it('asks for the front of the package when the name is missing', () => {
    const result = { unit_nutrition_per_100g: { calories: 500 } }

    expect(describeCustomImport(customDraftFromPackagedExtract(result), result)).toContain('正面')
  })

  it('names the reason when the backend wants the user to confirm', () => {
    const result = { ...chips, catalog_category: 'dairy', needs_user_confirmation: true }

    expect(describeCustomImport(customDraftFromPackagedExtract(result), result)).toContain('重点核对')
  })
})

describe('isSnackCustomFood', () => {
  it('only matches custom foods filed as snacks', () => {
    expect(isSnackCustomFood({ source: 'custom', category: 'snack' })).toBe(true)
    expect(isSnackCustomFood({ source: 'custom', category: 'custom' })).toBe(false)
    expect(isSnackCustomFood({ source: 'custom' })).toBe(false)
    expect(isSnackCustomFood({ source: 'packaged_food', category: 'snack' })).toBe(false)
  })
})

describe('pollPackagedExtractResult', () => {
  function deps(statuses: Array<Record<string, unknown>>): CustomImportDeps {
    const queue = [...statuses]
    return {
      getTask: jest.fn(async () => queue.shift() as never),
      wait: () => Promise.resolve(),
      now: () => 0,
    }
  }

  it('waits until the task is done and returns the packaged product', async () => {
    const result = await pollPackagedExtractResult('t1', () => false, deps([
      { status: 'pending' },
      { status: 'processing' },
      { status: 'done', result: { packaged_product: { product_name: '薯片' } } },
    ]))

    expect(result?.product_name).toBe('薯片')
  })

  it('reads the older nutrition result shape too', async () => {
    const result = await pollPackagedExtractResult('t1', () => false, deps([
      { status: 'done', result: { nutrition: { product_name: '饼干' } } },
    ]))

    expect(result?.product_name).toBe('饼干')
  })

  it('returns null without another request once the draft is abandoned', async () => {
    const d = deps([{ status: 'pending' }])

    await expect(pollPackagedExtractResult('t1', () => true, d)).resolves.toBeNull()
    expect(d.getTask).not.toHaveBeenCalled()
  })

  it('throws a readable error when the task fails', async () => {
    await expect(pollPackagedExtractResult('t1', () => false, deps([
      { status: 'failed', error_message: '' },
    ]))).rejects.toThrow('包装识别失败')
  })

  it('stops polling when moderation rejects the photos', async () => {
    const d = deps([{ status: 'violated', error_message: '图片未通过审核' }, { status: 'pending' }])

    await expect(pollPackagedExtractResult('t1', () => false, d)).rejects.toThrow('图片未通过审核')
    expect(d.getTask).toHaveBeenCalledTimes(1)
  })

  it('fails instead of returning an empty product when a done task has no result', async () => {
    await expect(pollPackagedExtractResult('t1', () => false, deps([
      { status: 'done', result: {} },
    ]))).rejects.toThrow('包装识别失败')
  })

  it('gives up after the time limit', async () => {
    let clock = 0
    const d: CustomImportDeps = {
      getTask: jest.fn(async () => ({ status: 'pending' }) as never),
      wait: async () => { clock += 60000 },
      now: () => clock,
    }

    await expect(pollPackagedExtractResult('t1', () => false, d)).rejects.toThrow('识别时间较长')
  })
})
