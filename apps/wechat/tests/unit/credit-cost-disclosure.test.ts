import { readFileSync } from 'fs'
import { resolve } from 'path'
import { getFoodCorrectionCreditCost } from '../../src/utils/membership'

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../src', relativePath), 'utf8')
}

describe('credit cost disclosure', () => {
  it('does not add zero-cost explanations to the invite flow', () => {
    expect(readSource('pages/profile/index.tsx')).not.toContain('不消耗积分')
    expect(readSource('packageExtra/pages/invite-friends/index.tsx')).not.toContain('不消耗积分')
  })

  it('shows concise costs at every fixed-price action', () => {
    expect(readSource('packageExtra/pages/analyze/index.tsx')).toContain('消耗 ${creditCost} 积分')
    expect(readSource('packageExtra/pages/record-text/index.tsx')).toContain('开始分析 · 2 积分')
    expect(readSource('packageExtra/pages/exercise-record/index.tsx')).toContain("className='exercise-compose-cost'>消耗 1 积分")
    expect(readSource('packageExtra/pages/expiry-edit/index.tsx')).toContain('消耗 {recognitionCreditCost} 积分')
    expect(readSource('pages/stats/index.tsx')).toContain('添加 · ${customFocusCost} 积分')
    expect(readSource('pages/stats/index.tsx')).toContain('更新 · 1 积分')
    expect(readSource('pages/stats/index.tsx')).toContain('更新 · ${customFocusCost} 积分')
    expect(readSource('packageExtra/pages/result/index.tsx')).toContain('重新分析 · {correctionCreditCost} 积分')
  })

  it('estimates dynamic pet chat cost before sending', () => {
    const source = readSource('packageExtra/pages/pet-chat/index.tsx')
    expect(source).toContain('estimatePetChat')
    expect(source).toContain('预计消耗 {estimatedCredits} 积分')
    expect(source).toContain('onClick={() => setInput(text)}')
  })

  it('matches the backend correction price for standard and precision modes', () => {
    expect(getFoodCorrectionCreditCost('standard')).toBe(1)
    expect(getFoodCorrectionCreditCost('strict')).toBe(2)
    expect(getFoodCorrectionCreditCost('strict_separate')).toBe(2)
  })
})
