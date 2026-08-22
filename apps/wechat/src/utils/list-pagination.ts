export interface LatestFeedCursor {
  before_time: string
  before_key: string
}

export function getFeedPageRequest(
  sortBy: string,
  cursor: LatestFeedCursor | null,
  requestedOffset: number,
  reset: boolean,
): { cursor: LatestFeedCursor | null; offset: number } {
  if (reset) {
    return { cursor: null, offset: 0 }
  }
  const latestCursor = sortBy === 'latest' ? cursor : null
  return {
    cursor: latestCursor,
    offset: latestCursor ? 0 : requestedOffset,
  }
}

interface CursorFeedItem {
  target_type?: string
  target_id?: string
  record?: {
    id?: string
    created_at?: string | null
  }
}

export function appendBoundedUnique<T>(
  existing: T[],
  incoming: T[],
  getKey: (item: T) => string,
  maxItems: number,
): { list: T[]; added: number; reachedLimit: boolean } {
  const safeMax = Math.max(1, Math.floor(maxItems))
  const list = existing.slice(0, safeMax)
  const seen = new Set(list.map(getKey).filter(Boolean))
  let added = 0
  let droppedForLimit = existing.length > safeMax
  for (const item of incoming) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    if (list.length >= safeMax) {
      droppedForLimit = true
      continue
    }
    seen.add(key)
    list.push(item)
    added++
  }
  return {
    list,
    added,
    reachedLimit: droppedForLimit || list.length >= safeMax,
  }
}

export function getLatestFeedCursor(items: CursorFeedItem[]): LatestFeedCursor | null {
  const last = items[items.length - 1]
  const targetId = String(last?.target_id || last?.record?.id || '').trim()
  const targetType = String(last?.target_type || 'food_record').trim()
  const rawTime = String(last?.record?.created_at || '').trim()
  if (!targetId || !targetType || !rawTime) return null
  const date = new Date(rawTime)
  if (!Number.isFinite(date.getTime())) return null
  return {
    before_time: rawTime,
    before_key: `${targetType}:${targetId}`,
  }
}
