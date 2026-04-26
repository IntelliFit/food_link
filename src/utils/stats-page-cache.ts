import Taro from '@tarojs/taro'
import type { StatsSummary } from './api'

const STATS_PAGE_CACHE_KEY = 'stats_page_bundle_v1'

type StatsPageCacheStore = {
  week?: StatsSummary
  month?: StatsSummary
}

function isStatsSummaryForRange(raw: unknown, range: 'week' | 'month'): raw is StatsSummary {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as StatsSummary
  return o.range === range && typeof o.start_date === 'string' && Array.isArray(o.daily_calories)
}

/** 读取分析页某周期的完整聚合数据（统计 + 合并后的 body_metrics） */
export function readStatsPageCache(range: 'week' | 'month'): StatsSummary | null {
  try {
    const raw = Taro.getStorageSync(STATS_PAGE_CACHE_KEY) as StatsPageCacheStore | undefined
    if (!raw || typeof raw !== 'object') return null
    const d = range === 'week' ? raw.week : raw.month
    return isStatsSummaryForRange(d, range) ? d : null
  } catch {
    return null
  }
}

/** 网络刷新成功后写入；与 `handleGenerateInsight` 等本地更新共用 */
export function writeStatsPageCache(range: 'week' | 'month', data: StatsSummary): void {
  try {
    const prev =
      (Taro.getStorageSync(STATS_PAGE_CACHE_KEY) as StatsPageCacheStore | undefined) || {}
    const next: StatsPageCacheStore = { ...prev }
    if (range === 'week') {
      next.week = data
    } else {
      next.month = data
    }
    Taro.setStorageSync(STATS_PAGE_CACHE_KEY, next)
  } catch (e) {
    console.error('[stats-page-cache] write failed', e)
  }
}
