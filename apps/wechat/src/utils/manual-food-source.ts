import { collectFoodDisplayImageUrls, hasFoodDisplayImage } from './food-display-image'

export type ManualFoodSourceType = 'public_library' | 'nutrition_library' | 'packaged_food'

export type ManualFoodSourceItem = {
  name?: string
  manual_source?: string | null
  manual_source_title?: string | null
  source_label?: string | null
  image_path?: string | null
  image_paths?: string[] | null
  nutrients?: { calories?: number }
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
  return Boolean(String(item.manual_source || '').trim())
}

/** 是否为手动记录产生的圈子动态（拍照识别等不含 manual_source 的不算） */
export function isManualFoodFeedRecord(
  record?: { description?: string | null; items?: ManualFoodSourceItem[] | null } | null
): boolean {
  if (!record) return false
  const desc = String(record.description || '').trim()
  if (desc.startsWith('手动记录：') || desc.startsWith('手动记录:')) return true
  if (!Array.isArray(record.items) || record.items.length === 0) return false
  return record.items.some((item) => isManualFoodSourceItem(item))
}

/** 从饮食记录 items 中筛出手动记录条目（含来源标签与图片字段规范化） */
export function extractManualFoodDisplayItems(
  items?: ManualFoodSourceItem[] | null
): Array<ManualFoodSourceItem & { displayName: string; sourceLabel: string; imageUrl: string }> {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => isManualFoodSourceItem(item))
    .map((item) => {
      const displayName = String(item.manual_source_title || item.name || '').trim() || '食物'
      const urls = collectFoodDisplayImageUrls(item)
      return {
        ...item,
        displayName,
        sourceLabel: manualFoodSourceLabel(item.manual_source, item.source_label),
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
