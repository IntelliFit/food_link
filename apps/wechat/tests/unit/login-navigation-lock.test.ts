import {
  acquireLoginNavigationLock,
  resetLoginNavigationLock,
} from '../../src/utils/login-navigation-lock'

describe('login navigation lock', () => {
  beforeEach(() => resetLoginNavigationLock())

  it('allows only one login navigation during the short transition window', () => {
    expect(acquireLoginNavigationLock(1000)).toBe(true)
    expect(acquireLoginNavigationLock(1200)).toBe(false)
    expect(acquireLoginNavigationLock(2500)).toBe(true)
  })
})
