/**
 * 分包 root，须与 `app.config.ts` 中 `subpackages[].root` 一致。
 */
export const SUBPACKAGE_EXTRA_ROOT = '/packageExtra' as const

/** TabBar 主包页面（与 `getCurrentPageRoute()` 一致，形如 /pages/xxx/index） */
export const MAIN_TAB_ROUTES: ReadonlySet<string> = new Set([
  '/pages/index/index',
  '/pages/stats/index',
  '/pages/record/index',
  '/pages/community/index',
  '/pages/profile/index',
])

/**
 * 非 Tab 的页面均在 `packageExtra` 分包，navigateTo/redirectTo 须使用完整路径。
 *
 * @param pathWithOptionalQuery 如 `/pages/login/index` 或 `/pages/foo/index?a=1`
 */
export function extraPkgUrl(pathWithOptionalQuery: string): string {
  const raw = (pathWithOptionalQuery || '').trim()
  if (!raw) return SUBPACKAGE_EXTRA_ROOT
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  const q = withSlash.indexOf('?')
  if (q === -1) {
    return `${SUBPACKAGE_EXTRA_ROOT}${withSlash}`
  }
  return `${SUBPACKAGE_EXTRA_ROOT}${withSlash.slice(0, q)}${withSlash.slice(q)}`
}

/**
 * 登录成功后的回跳 URL：兼容本地仍保存的旧版主包路径 `/pages/...`。
 */
export function normalizeRedirectUrlForSubpackage(fullUrl: string): string {
  const t = (fullUrl || '').trim()
  if (!t) return t
  if (t.startsWith(SUBPACKAGE_EXTRA_ROOT)) return t
  const qIdx = t.indexOf('?')
  const pathPart = qIdx === -1 ? t : t.slice(0, qIdx)
  const query = qIdx === -1 ? '' : t.slice(qIdx)
  const clean = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
  if (clean.startsWith('/pages/') && !MAIN_TAB_ROUTES.has(clean)) {
    return `${SUBPACKAGE_EXTRA_ROOT}${clean}${query}`
  }
  return t
}
