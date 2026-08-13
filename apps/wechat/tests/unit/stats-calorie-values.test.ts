import { readFileSync } from 'fs'
import { join } from 'path'

describe('stats calorie trend values', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/pages/stats/index.tsx'),
    'utf8',
  )

  it('always renders calorie values without a display switch', () => {
    expect(pageSource).toContain(
      "<Text className='bar-calorie-text'>{Math.round(item.calories)}</Text>",
    )
    expect(pageSource).not.toContain('显示数值')
    expect(pageSource).not.toContain('showCalories')
    expect(pageSource).not.toContain('<Switch')
  })
})
