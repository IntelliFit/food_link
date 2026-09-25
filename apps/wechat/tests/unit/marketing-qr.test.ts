import { parseMarketingCodeFromLaunchOptions } from '../../src/utils/marketing-qr'

describe('marketing QR launch parsing', () => {
  it('parses the product code from an unlimited-code scene', () => {
    expect(parseMarketingCodeFromLaunchOptions({
      query: { scene: 'mq%3Dssx21969008829314212' },
    })).toBe('ssx21969008829314212')
  })

  it('parses the unified takeaway code from a direct query', () => {
    expect(parseMarketingCodeFromLaunchOptions({
      query: { mq: 'TAKEOUT' },
    })).toBe('takeout')
  })

  it('rejects unsupported scene values', () => {
    expect(parseMarketingCodeFromLaunchOptions({
      query: { scene: 'mq=../../bad' },
    })).toBe('')
  })
})
