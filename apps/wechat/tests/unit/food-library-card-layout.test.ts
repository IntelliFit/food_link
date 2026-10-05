import { readFileSync } from 'fs'
import { join } from 'path'

describe('public food library card layout', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/food-library/index.tsx'),
    'utf8',
  )
  const pageScss = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/food-library/index.scss'),
    'utf8',
  )

  it('shows campus canteen information once and keeps calories in the compact summary', () => {
    expect(pageSource).toContain("item.merchant_name || item.detail_address || item.merchant_address || '地点待补充'")
    expect(pageSource.match(/className='campus-food-location'/g)).toHaveLength(1)
    expect(pageSource).toContain("className='atlas-food-price'")
    expect(pageSource).toContain("nutritionAvailable ? `${item.total_calories.toFixed(0)} kcal · 蛋白 ${item.total_protein.toFixed(0)}g` : '营养待补充'")
    expect(pageSource).not.toContain("className='campus-food-price'")
  })

  it('renders the official publisher as text without an avatar placeholder', () => {
    expect(pageSource).toContain("const officialAuthor = !String(item.user_id || '').trim() && item.author?.nickname === '食探官方'")
    expect(pageSource).toContain('!officialAuthor && item.author?.avatar')
    expect(pageSource).toContain("officialAuthor ? 'author-name--official' : ''")
  })

  it('uses the three page text sizes and a compact card image', () => {
    expect(pageScss).toContain('$food-library-font-large: 30rpx;')
    expect(pageScss).toContain('$food-library-font-body: 26rpx;')
    expect(pageScss).toContain('$food-library-font-meta: 24rpx;')
    expect(pageScss).toMatch(/\.food-image-wrap\s*{[^}]*width:\s*176rpx;[^}]*height:\s*176rpx;/)
    expect(pageScss).toMatch(/\.fat-loss-badge\s*{[^}]*top:\s*42rpx;/)
    expect(pageScss).toMatch(/\.food-image-wrap\s*{[^}]*width:\s*152rpx;[^}]*height:\s*152rpx;/)
  })
})
