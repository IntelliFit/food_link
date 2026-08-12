import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('metabolic native popup visibility', () => {
  it('does not mount the physiology overlay while open is false', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/packageExtra/pages/stats-metabolic/metabolic-dynamics-report.tsx'),
      'utf8'
    )

    expect(source).toMatch(/function MetabolicPhysiologyPopup[\s\S]*?if \(!open\) return null[\s\S]*?metabolic-phys-popup__portal/)
  })
})
