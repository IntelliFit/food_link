import { readFileSync } from 'fs'
import { resolve } from 'path'

const invitePageSource = readFileSync(
  resolve(__dirname, '../../src/packageExtra/pages/invite-friends/index.tsx'),
  'utf8',
)

describe('invite friends layout', () => {
  it('places membership rewards second and the rules card after invite progress', () => {
    const rewardsIndex = invitePageSource.indexOf("className='invite-card invite-rewards-section'")
    const rulesIndex = invitePageSource.indexOf("className='invite-card rules-card'")
    const progressIndex = invitePageSource.indexOf("className='invite-card invite-progress-card'")

    expect(rewardsIndex).toBeGreaterThan(-1)
    expect(rewardsIndex).toBeLessThan(progressIndex)
    expect(progressIndex).toBeLessThan(rulesIndex)
  })

  it('does not render or load the QR image sharing card', () => {
    expect(invitePageSource).not.toContain('扫码也能加入')
    expect(invitePageSource).not.toContain('getUnlimitedQRCode')
    expect(invitePageSource).not.toContain("className='invite-card qr-card'")
  })
})
