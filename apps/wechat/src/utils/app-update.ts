import Taro from '@tarojs/taro'

let pendingManager: Taro.UpdateManager | null = null

/**
 * 新版本下载完后提示重新打开。
 * 没有这一步时，手机会继续用本地旧包，有问题的版本也要等微信自己更新才能换掉。
 */
export function installAppUpdateCheck(): void {
  try {
    if (!Taro.canIUse('getUpdateManager')) return
    const manager = Taro.getUpdateManager()
    manager.onUpdateReady(() => {
      pendingManager = manager
      void Taro.showModal({
        title: '发现新版本',
        content: '新版本已经准备好，重新打开后生效。',
        showCancel: false,
        confirmText: '重新打开',
        confirmColor: '#2e6b50',
      }).then((result) => {
        if (result.confirm) manager.applyUpdate()
      }).catch(() => {
        // 弹窗失败时下一次冷启动也会用上新版本。
      })
    })
    manager.onUpdateFailed(() => {
      console.warn('[app-update] 新版本下载失败，下次启动再试')
    })
  } catch (error) {
    console.warn('[app-update] 更新检查不可用', String(error))
  }
}

/** 已下载好新版本时直接切换，返回是否已切换。 */
export function applyPendingAppUpdate(): boolean {
  if (!pendingManager) return false
  pendingManager.applyUpdate()
  return true
}
