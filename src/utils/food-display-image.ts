/**
 * 标准食物库 / 饮食记录展示用图片 URL 校验与聚合。
 * 仅当为可加载的 http(s) 或本地 wxfile 路径时视为有效，否则走占位符。
 */

export type FoodImageSource = {
  image_path?: string | null
  image_paths?: string[] | null
  images?: string[] | null
}

const INVALID_LITERALS = new Set(['null', 'undefined', 'none', 'n/a', '[]'])

/** 清洗单条图片 URL；无效则返回空字符串。 */
export function sanitizeFoodDisplayImageUrl(url: unknown): string {
  if (typeof url !== 'string') return ''
  const raw = url.trim()
  if (!raw || INVALID_LITERALS.has(raw.toLowerCase())) return ''
  if (/^https?:\/\/tmp\//i.test(raw)) {
    return raw.replace(/^https?:\/\/tmp\//i, 'wxfile://tmp/')
  }
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^wxfile:\/\//i.test(raw)) return raw
  return ''
}

/** 从 image_path / image_paths / images 聚合去重后的有效 URL 列表。 */
export function collectFoodDisplayImageUrls(source?: FoodImageSource | null): string[] {
  if (!source) return []
  const seen = new Set<string>()
  const out: string[] = []
  const push = (value: unknown) => {
    const sanitized = sanitizeFoodDisplayImageUrl(value)
    if (!sanitized || seen.has(sanitized)) return
    seen.add(sanitized)
    out.push(sanitized)
  }
  if (Array.isArray(source.image_paths)) {
    for (const path of source.image_paths) push(path)
  }
  if (Array.isArray(source.images)) {
    for (const path of source.images) push(path)
  }
  push(source.image_path)
  return out
}

export function pickFoodDisplayImageUrl(source?: FoodImageSource | null): string {
  return collectFoodDisplayImageUrls(source)[0] || ''
}

export function hasFoodDisplayImage(source?: FoodImageSource | null): boolean {
  return collectFoodDisplayImageUrls(source).length > 0
}
