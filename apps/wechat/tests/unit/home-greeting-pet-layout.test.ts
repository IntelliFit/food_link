import * as fs from 'node:fs'
import * as path from 'node:path'

describe('home greeting pet layout', () => {
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/pages/index/index.tsx'),
    'utf8',
  )
  const styleSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/pages/index/index.scss'),
    'utf8',
  )

  it('enlarges every greeting pet by about 20 percent', () => {
    expect(pageSource).toContain("className='greeting-pet__avatar'")
    expect(pageSource).toContain('size={67}')
    expect(styleSource).toMatch(/\.greeting-pet__avatar\s*{[\s\S]*?width:\s*134rpx\s*!important;[\s\S]*?height:\s*134rpx\s*!important;/)
  })

  it('keeps tall ears and headwear outside the crop boundary', () => {
    expect(styleSource).toMatch(/\.greeting-pet\s*{[\s\S]*?height:\s*116rpx;[\s\S]*?overflow:\s*visible;/)
  })
})
