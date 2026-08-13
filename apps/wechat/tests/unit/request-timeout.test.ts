import {
  DEFAULT_AUTHENTICATED_REQUEST_TIMEOUT_MS,
  resolveAuthenticatedRequestTimeout,
} from '../../src/utils/request-timeout'

describe('authenticated request timeout', () => {
  it('uses a finite default while preserving valid endpoint-specific timeouts', () => {
    expect(resolveAuthenticatedRequestTimeout()).toBe(DEFAULT_AUTHENTICATED_REQUEST_TIMEOUT_MS)
    expect(resolveAuthenticatedRequestTimeout(0)).toBe(DEFAULT_AUTHENTICATED_REQUEST_TIMEOUT_MS)
    expect(resolveAuthenticatedRequestTimeout(22000)).toBe(22000)
  })
})
