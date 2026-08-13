export const DEFAULT_AUTHENTICATED_REQUEST_TIMEOUT_MS = 15000

export function resolveAuthenticatedRequestTimeout(timeout?: number): number {
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    return timeout
  }
  return DEFAULT_AUTHENTICATED_REQUEST_TIMEOUT_MS
}
