import { readFileSync } from 'fs'
import { join } from 'path'

describe('analysis result independent intake ratios', () => {
  const resultSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/result/index.tsx'),
    'utf8',
  )

  it('explains that every recognized food can be adjusted independently', () => {
    expect(resultSource).toContain('食物明细')
    expect(resultSource).toContain('每种食物可单独调整实际食用比例')
    expect(resultSource).toContain("className='ingredient-card'")
    expect(resultSource).toContain('handleRatioAdjust(item.id')
  })
})
