import { collectFoodDisplayImageUrls, hasFoodDisplayImage } from './food-display-image'

export type ManualFoodSourceType = 'public_library' | 'nutrition_library' | 'packaged_food'

export type ManualFoodSourceItem = {
  name?: string
  manual_source?: string | null
  manual_source_id?: string | null
  manual_source_title?: string | null
  source_label?: string | null
  image_path?: string | null
  image_paths?: string[] | null
  nutrients?: { calories?: number }
  /** 从结果页保存时可能只带了库 ID，需要兜底识别为食物库来源 */
  packaged_food_id?: string | null
  matched_food_id?: string | null
  nutrition_source?: string | null
  nutrition_source_category?: string | null
}

type ResolvedManualSource = {
  source: string
  sourceId?: string | null
  sourceTitle?: string | null
}

export type ManualFoodDisplayRecordLike = {
  entry_type?: string | null
  source_task_id?: string | null
  recipe_id?: string | null
  description?: string | null
  items?: ManualFoodSourceItem[] | null
}

const strOrEmpty = (value?: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const MANUAL_CARD_ENTRY_TYPES = new Set(['food_library', 'public_food_library'])
const NON_MANUAL_CARD_ENTRY_TYPES = new Set([
  'food_image',
  'food_text',
  'analyze_history',
  'favorite_recipe',
  'campus_canteen',
  'unknown'
])

/** 从 item 上各种可能的字段推断食物库来源（兼容未写 manual_source 的旧记录） */
export function resolveManualSource(item?: ManualFoodSourceItem | null): ResolvedManualSource {
  if (!item) return { source: '' }

  const explicitSource = strOrEmpty(item.manual_source)
  if (explicitSource) {
    return {
      source: explicitSource,
      sourceId: item.manual_source_id,
      sourceTitle: item.manual_source_title || item.name,
    }
  }

  const packagedFoodId = strOrEmpty(item.packaged_food_id)
  const matchedFoodId = strOrEmpty(item.matched_food_id)
  const nutritionSource = strOrEmpty(item.nutrition_source).toLowerCase()
  const nutritionSourceCategory = strOrEmpty(item.nutrition_source_category).toLowerCase()

  if (packagedFoodId || nutritionSource.includes('packaged')) {
    return { source: 'packaged_food', sourceId: packagedFoodId || undefined, sourceTitle: item.name }
  }
  if (matchedFoodId || (nutritionSourceCategory === 'database' && nutritionSource.includes('library'))) {
    return { source: 'nutrition_library', sourceId: matchedFoodId || undefined, sourceTitle: item.name }
  }

  return { source: '' }
}

/** 手动记录来源 → 圈子/列表展示标签 */
export function manualFoodSourceLabel(source?: string | null, fallbackLabel?: string | null): string {
  const custom = String(fallbackLabel || '').trim()
  if (custom) return custom
  switch (String(source || '').trim()) {
    case 'public_library':
      return '真实餐食'
    case 'packaged_food':
      return '包装食品'
    case 'nutrition_library':
      return '常用食物'
    default:
      return ''
  }
}

export function isManualFoodSourceItem(item?: ManualFoodSourceItem | null): boolean {
  if (!item) return false
  return Boolean(resolveManualSource(item).source)
}

/** 旧数据回退：只有缺失 entry_type 的老手动记录才走这里。 */
export function isManualFoodFeedRecord(
  record?: { description?: string | null; items?: ManualFoodSourceItem[] | null } | null
): boolean {
  if (!record) return false
  const desc = String(record.description || '').trim()
  if (!desc.startsWith('手动记录：') && !desc.startsWith('手动记录:')) return false
  return hasManualFoodDisplayItems(record.items)
}

/**
 * 是否应展示逐食材卡片。
 * 规则：
 * - `food_library` / `public_food_library` 一律展示逐食材卡片
 * - `food_image` / `food_text` / `analyze_history` / `favorite_recipe` 等显式非手动入口一律不展示
 * - 仅当 `entry_type` 缺失时，才允许老数据按「手动记录：」+ 手动来源 items 回退
 */
export function shouldRenderManualFoodCards(
  record?: ManualFoodDisplayRecordLike | null
): boolean {
  if (!record) return false
  const entryType = strOrEmpty(record.entry_type)
  if (entryType) {
    if (MANUAL_CARD_ENTRY_TYPES.has(entryType)) {
      return hasManualFoodDisplayItems(record.items)
    }
    if (NON_MANUAL_CARD_ENTRY_TYPES.has(entryType)) {
      return false
    }
    return false
  }

  if (strOrEmpty(record.source_task_id) || strOrEmpty(record.recipe_id)) {
    return false
  }
  return isManualFoodFeedRecord(record)
}

/** 兼容旧调用名，内部已改为 entry_type 优先判定。 */
export function shouldUseManualFoodCards(
  record?: ManualFoodDisplayRecordLike | null
): boolean {
  return shouldRenderManualFoodCards(record)
}

/** 从饮食记录 items 中筛出手动记录条目（含来源标签与图片字段规范化） */
export function extractManualFoodDisplayItems(
  items?: ManualFoodSourceItem[] | null
): Array<ManualFoodSourceItem & { displayName: string; sourceLabel: string; imageUrl: string }> {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => isManualFoodSourceItem(item))
    .map((item) => {
      const resolved = resolveManualSource(item)
      const displayName = String(resolved.sourceTitle || item.name || '').trim() || '食物'
      const urls = collectFoodDisplayImageUrls(item)
      return {
        ...item,
        manual_source: (resolved.source || item.manual_source || '') as ManualFoodSourceItem['manual_source'],
        manual_source_id: resolved.sourceId || item.manual_source_id || null,
        manual_source_title: resolved.sourceTitle || item.manual_source_title || item.name || null,
        displayName,
        sourceLabel: manualFoodSourceLabel(resolved.source, item.source_label),
        imageUrl: urls[0] || '',
        image_path: urls[0] || item.image_path || null,
        image_paths: urls.length > 0 ? urls : item.image_paths,
      }
    })
    .filter((item) => item.displayName !== '')
}

export function hasManualFoodDisplayItems(items?: ManualFoodSourceItem[] | null): boolean {
  return extractManualFoodDisplayItems(items).length > 0
}

export function manualItemHasDisplayImage(
  item: Pick<ManualFoodSourceItem, 'image_path' | 'image_paths'>
): boolean {
  return hasFoodDisplayImage(item)
}
