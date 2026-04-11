/** 记运动等操作完成后通知首页：标记「今日」数据需刷新（回到首页时再拉） */
export const HOME_DASHBOARD_REFRESH_EVENT = 'home-dashboard:refresh'

/** 新增/删除饮食记录等后通知首页：标记需刷新 */
export const HOME_INTAKE_DATA_CHANGED_EVENT = 'home-intake:changed'

/** 首页「今日」dashboard 缓存可接受时长（毫秒）；超时后回到首页会重拉 */
export const HOME_DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000
