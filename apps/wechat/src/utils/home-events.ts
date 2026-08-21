export interface HomeDashboardRefreshPayload {
  date?: string
  force?: boolean
  /** 体重/喝水只刷新身体指标，避免重新拉整套首页聚合数据。 */
  bodyMetricsOnly?: boolean
}

/** 记运动等操作完成后通知首页：标记对应日期数据需刷新 */
export const HOME_DASHBOARD_REFRESH_EVENT = 'home-dashboard:refresh'

/** 新增/删除饮食记录等后通知首页：标记需刷新 */
export const HOME_INTAKE_DATA_CHANGED_EVENT = 'home-intake:changed'

/** 删除饮食记录后通知社区页面：强制刷新 Feed */
export const COMMUNITY_FEED_CHANGED_EVENT = 'community-feed:changed'

/** 首页「今日」dashboard 缓存可接受时长（毫秒）；超时后回到首页会重拉 */
export const HOME_DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000
