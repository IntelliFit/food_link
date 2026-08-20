import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('pro membership visual simplification', () => {
  const pageSource = readFileSync(
    resolve(__dirname, '../../src/packageExtra/pages/pro-membership/index.tsx'),
    'utf8',
  )
  const styleSource = readFileSync(
    resolve(__dirname, '../../src/packageExtra/pages/pro-membership/index.scss'),
    'utf8',
  )

  it('keeps the hero title without a subtitle', () => {
    expect(pageSource).toContain("className='hero-title'>食探会员")
    expect(pageSource).not.toContain("className='hero-subtitle'")
    expect(styleSource).not.toContain('.hero-subtitle')
  })

  it('removes the standalone virtual payment notice card', () => {
    expect(pageSource).not.toContain("className='virtual-payment-notice'")
    expect(pageSource).not.toContain('iOS 端通过 Apple 支付，其他平台通过微信支付')
    expect(styleSource).not.toContain('.virtual-payment-notice')
  })
})
