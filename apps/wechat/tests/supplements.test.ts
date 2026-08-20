import { cloneCatalogComponents, componentsFromNutritionLabel, normalizeSupplementCode, supplementOcrBasisText } from '../src/utils/supplements'

describe('supplement helpers', () => {
  it('converts per-100g OCR values to one serving when serving weight exists', () => {
    const result = componentsFromNutritionLabel({ serving_weight_g: 2, magnesium_mg_per_100g: 10000 })
    expect(result).toEqual([expect.objectContaining({ nutrient_key: 'magnesiumMg', amount: 200, unit: 'mg' })])
    expect(supplementOcrBasisText({ serving_weight_g: 2 })).toContain('每份 2g')
  })

  it('keeps label value when serving weight is unknown and normalizes codes', () => {
    const result = componentsFromNutritionLabel({ vitamin_d_mcg_per_100g: 25 })
    expect(result[0].amount).toBe(25)
    expect(normalizeSupplementCode('L- Theanine / 200')).toBe('l_theanine_200')
  })

  it('copies catalog components before the user edits the template', () => {
    const catalog: any = {
      id: 'd3', name: '维生素D3', components: [{ code: 'vitamin_d', name: '维生素D', category: 'nutrient', amount: 25, unit: 'mcg' }],
    }
    const result = cloneCatalogComponents(catalog)
    result[0].amount = 50
    expect(catalog.components[0].amount).toBe(25)
  })
})
