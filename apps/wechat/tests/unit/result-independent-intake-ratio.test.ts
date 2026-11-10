import { readFileSync } from 'fs'
import { join } from 'path'

describe('analysis result independent intake ratios', () => {
  const resultSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/result/index.tsx'),
    'utf8',
  )

  // 2026-11-09 结果页减字：去掉了「每种食物可单独调整实际食用比例」那行说明，
  // 但每张食物卡片收起时也一直露着自己的「实际摄入」滑条。
  it('keeps an intake slider on every recognized food card', () => {
    expect(resultSource).toContain('食物明细')
    expect(resultSource).toContain('className={`ingredient-card ')
    expect(resultSource).toContain("<Text className='control-label'>实际摄入</Text>")
    expect(resultSource).toContain('handleRatioAdjust(item.id')
  })
})
