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
    expect(pageSource).toContain('item.merchant_name && !campusFood')
    expect(pageSource).toContain('item.description && item.food_name && !campusFood')
    expect(pageSource).toContain("className='campus-food-summary'")
    expect(pageSource).toContain("className='campus-food-calories'")
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
    expect(pageScss).toContain('$food-library-font-meta: 22rpx;')
    expect(pageScss).toMatch(/\.food-image-wrap\s*{[^}]*width:\s*176rpx;[^}]*height:\s*176rpx;/)
    expect(pageScss).toMatch(/\.fat-loss-badge\s*{[^}]*top:\s*42rpx;/)
  })
})
