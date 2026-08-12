import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('invite friends credit cost disclosure', () => {
  const pageSource = readFileSync(
    resolve(__dirname, '../../src/packageExtra/pages/invite-friends/index.tsx'),
    'utf8',
  )
  const styleSource = readFileSync(
    resolve(__dirname, '../../src/packageExtra/pages/invite-friends/index.scss'),
    'utf8',
  )

  it('states before the invite actions that the feature does not consume credits', () => {
    expect(pageSource).toContain("<View className='invite-credit-notice'>")
    expect(pageSource).toContain('邀请、分享和领取会员奖励，全程不消耗积分')
    expect(styleSource).toContain('.invite-credit-notice')
  })
})
