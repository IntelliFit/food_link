import { scaleCaloriesForWeight } from '../../src/packageExtra/pages/result/weight-adjust'

describe('scaleCaloriesForWeight', () => {
  it('keeps the energy density of label or library calories when weight changes', () => {
    // 100g 标签 300 千卡，三大营养素折算仅 260 千卡；加到 110g 应为 330，而不是按 4/4/9 的 286。
    expect(scaleCaloriesForWeight(300, 1.1, 286)).toBeCloseTo(330)
    expect(scaleCaloriesForWeight(300, 0.9, 234)).toBeCloseTo(270)
  })

  it('falls back to macro calories only when the current calories are missing', () => {
    expect(scaleCaloriesForWeight(0, 1.1, 286)).toBe(286)
    expect(scaleCaloriesForWeight(Number.NaN, 1.1, 286)).toBe(286)
  })
})
