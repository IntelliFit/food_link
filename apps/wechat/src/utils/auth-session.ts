import Taro from '@tarojs/taro'

export const AUTH_SESSION_CHANGED_EVENT = 'product_update_auth_changed'

export interface AuthSession {
  token: string
  userId: string
  generation: number
}

// Increment even when the same account (or token) logs in again. Comparing only
// user_id would allow a response from A -> B -> A to enter the new session.
let generation = 0

export function captureAuthSession(): AuthSession {
  try {
    return {
      token: String(Taro.getStorageSync('access_token') || ''),
      userId: String(Taro.getStorageSync('user_id') || '').trim(),
      generation,
    }
  } catch {
    return { token: '', userId: '', generation }
  }
}

export function isAuthSessionCurrent(session: AuthSession): boolean {
  const current = captureAuthSession()
  return session.generation === current.generation
    && session.token === current.token
    && session.userId === current.userId
}

/** Called by the token writer before notifying retained pages. */
export function advanceAuthSession(): void {
  generation += 1
}

export function authSessionChangedError(): Error {
  return Object.assign(new Error('登录状态已变化，请重试'), { code: 'auth_session_changed' })
}
