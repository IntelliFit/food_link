const LOGIN_NAVIGATION_LOCK_MS = 1500

let loginNavigationLockedUntil = 0

/**
 * 登录守卫可能在首屏 effect、useDidShow 和并发 401 中同时触发。
 * 用一个短时进程内互斥避免重复压入登录页或互相覆盖跳转。
 */
export function acquireLoginNavigationLock(now = Date.now()): boolean {
  if (now < loginNavigationLockedUntil) return false
  loginNavigationLockedUntil = now + LOGIN_NAVIGATION_LOCK_MS
  return true
}

export function resetLoginNavigationLock(): void {
  loginNavigationLockedUntil = 0
}
