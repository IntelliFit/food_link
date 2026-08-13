/**
 * 旧请求可能在重新登录成功后才返回 401。只有请求 token 仍是当前 token，
 * 或当前已没有 token 时，才允许清理登录态并再次跳转登录页。
 */
export function shouldHandleAuthenticationFailure(
  requestToken: string,
  currentToken: string | null,
): boolean {
  return !currentToken || currentToken === requestToken
}
