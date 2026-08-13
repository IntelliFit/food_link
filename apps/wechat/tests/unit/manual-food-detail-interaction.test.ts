import { readFileSync } from 'fs'
import { join } from 'path'

describe('manual food detail interaction', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/record-manual/index.tsx'),
    'utf8',
  )

  it('opens nutrition details from the food row instead of adding immediately', () => {
    expect(source).toContain("className='food-item'\n        onClick={() => setDetailItem(item)}")
    expect(source).toContain("className='food-detail-title'>营养详情")
    expect(source).toContain("className='food-detail-section-title'>宏量营养")
    expect(source).toContain("className='food-detail-section-title'>微量元素与其他营养")
  })

  it('adds food only from an explicit plus action', () => {
    expect(source).toContain('event.stopPropagation()\n              handleAddItem(item)')
    expect(source).toContain("<Text>+</Text>")
    expect(source).toContain("? '+ 再加一份' : '+ 加入本餐'")
  })
})
