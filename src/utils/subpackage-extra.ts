/**
 * 分包 root，须与 `app.config.ts` 中 `subpackages[].root` 一致。
 */
export const SUBPACKAGE_EXTRA_ROOT = '/packageExtra' as const
export const SUBPACKAGE_ABOUT_ROOT = '/packageAbout' as const
export const SUBPACKAGE_USER_GROUP_ROOT = '/packageUserGroup' as const
export const SUBPACKAGE_STATS_METABOLIC_ROOT = '/packageStatsMetabolic' as const

const EXTRA_PACKAGE_ROOT_BY_PAGE: Readonly<Record<string, string>> = {
  '/pages/about/index': SUBPACKAGE_ABOUT_ROOT,
  '/pages/user-group/index': SUBPACKAGE_USER_GROUP_ROOT,
  '/pages/stats-metabolic/index': SUBPACKAGE_STATS_METABOLIC_ROOT,
}

const KNOWN_EXTRA_PACKAGE_ROOTS = [
  SUBPACKAGE_EXTRA_ROOT,
  SUBPACKAGE_ABOUT_ROOT,
  SUBPACKAGE_USER_GROUP_ROOT,
  SUBPACKAGE_STATS_METABOLIC_ROOT,
] as const

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
  const pathPart = q === -1 ? withSlash : withSlash.slice(0, q)
  const root = EXTRA_PACKAGE_ROOT_BY_PAGE[pathPart] || SUBPACKAGE_EXTRA_ROOT
  if (q === -1) {
    return `${root}${withSlash}`
  }
  return `${root}${pathPart}${withSlash.slice(q)}`
}

/**
 * 登录成功后的回跳 URL：兼容本地仍保存的旧版主包路径 `/pages/...`
 * 和旧的统一分包路径 `/packageExtra/pages/...`。
 */
export function normalizeRedirectUrlForSubpackage(fullUrl: string): string {
  const t = (fullUrl || '').trim()
  if (!t) return t
  const qIdx = t.indexOf('?')
  const pathPart = qIdx === -1 ? t : t.slice(0, qIdx)
  const query = qIdx === -1 ? '' : t.slice(qIdx)
  let clean = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
  for (const root of KNOWN_EXTRA_PACKAGE_ROOTS) {
    if (clean.startsWith(`${root}/pages/`)) {
      clean = clean.slice(root.length)
      break
    }
  }
  if (clean.startsWith('/pages/') && !MAIN_TAB_ROUTES.has(clean)) {
    return extraPkgUrl(`${clean}${query}`)
  }
  return t
}
