import Taro from '@tarojs/taro'
import { refreshHomeDashboardLocalSnapshotFromCloud } from './home-dashboard-local-cache'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from './home-events'

function notifyHome(date: string, force: boolean): void {
  try {
    Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, force ? { date, force: true } : { date })
  } catch {
    /* 首页没挂载时没人监听，忽略 */
  }
}

/**
 * 记完一餐后同步首页：先把当天数据标成过期，再在后台拉一次首页快照，拉完让首页按新快照重画。
 * 调用方不要 await：那是一整次首页接口，用户会多等一两秒才看到「已记录」。
 * 刷新没赶上时，首页已被标成过期，回首页会自己重拉。
 */
export async function syncHomeAfterFoodRecordSave(date: string): Promise<void> {
  notifyHome(date, false)
  try {
    await refreshHomeDashboardLocalSnapshotFromCloud(date)
  } catch {
    /* 首页回来会自己重拉 */
  }
  notifyHome(date, true)
}
