import { shouldHandleAuthenticationFailure } from '../../src/utils/auth-request-state'

describe('authentication request state', () => {
  it('ignores a stale 401 after a newer login token has been stored', () => {
    expect(shouldHandleAuthenticationFailure('old-token', 'new-token')).toBe(false)
    expect(shouldHandleAuthenticationFailure('same-token', 'same-token')).toBe(true)
    expect(shouldHandleAuthenticationFailure('old-token', '')).toBe(true)
  })
})
