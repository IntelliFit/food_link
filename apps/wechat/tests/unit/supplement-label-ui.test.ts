import { readFileSync } from 'fs'
import { resolve } from 'path'

const readSource = (relativePath: string) => readFileSync(resolve(__dirname, '../../src', relativePath), 'utf8')

describe('supplement label and micronutrient source UI', () => {
  it('keeps supplement micronutrients in the four-column grid and opens a source sheet', () => {
    const component = readSource('pages/index/components/MicrosSection.tsx')
    const styles = readSource('pages/index/index.scss')

    expect(styles).not.toMatch(/\.micros-preview-card\.has-supplement\s*\{[\s\S]*?grid-column:\s*span\s+2/)
    expect(component).toContain("className='micros-supplement-badge'")
    expect(component).toContain("className='micros-source-sheet'")
    expect(component).not.toContain("className='micros-source-compact'")
  })

  it('allows up to three supplement label images and calls the dedicated multi-image endpoint', () => {
    const page = readSource('packageExtra/pages/supplement-edit/index.tsx')
    const api = readSource('utils/api.ts')

    expect(page).toContain('MAX_SUPPLEMENT_LABEL_IMAGES = 3')
    expect(page).toContain('连续拍摄（推荐2张）')
    expect(page).toContain('recognizeSupplementLabel(imageUrls)')
    expect(page).toContain('item.image_urls?.length')
    expect(page).toContain('image_urls: labelImageUrls')
    expect(api).toContain("'/api/supplements/label/recognize'")
    expect(api).toContain('data: { image_urls: normalized }')
  })

  it('keeps the daily plan above the long component list and exposes save feedback', () => {
    const page = readSource('packageExtra/pages/supplement-edit/index.tsx')
    const styles = readSource('packageExtra/pages/supplement-edit/index.scss')

    expect(page.indexOf("className='supplement-plan-card'")).toBeLessThan(page.indexOf('标签成分'))
    expect(page).toContain("className='supplement-save-dock'")
    expect(page).toContain("className='supplement-save-error'")
    expect(styles).toContain('position: fixed')
    expect(styles).toContain('.supplement-save-spinner')
  })
})
