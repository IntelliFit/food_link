import { readFileSync } from 'fs'
import { join } from 'path'

describe('wellness home final layout', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/pages/index/index.tsx'),
    'utf8',
  )
  const pageScss = readFileSync(
    join(process.cwd(), 'src/pages/index/index.scss'),
    'utf8',
  )
  const componentExports = readFileSync(
    join(process.cwd(), 'src/pages/index/components/index.ts'),
    'utf8',
  )

  it('maps calorie progress onto the visible three-quarter gauge track', () => {
    expect(pageSource).toContain(
      'const wellnessGaugePct = wellnessCaloriePct * 0.75',
    )
    expect(pageSource).toContain(
      "'--wellness-progress': `${wellnessGaugePct}%`",
    )
    expect(pageSource).toContain(
      'style={{ width: `${wellnessCaloriePct}%` }}',
    )
  })

  it('does not retain the removed diet recommendation UI artifacts', () => {
    expect(componentExports).not.toContain('DietRecommendationSheet')
    expect(pageScss).not.toContain('.diet-rec-')
  })
})
