declare const wx: any

/** 后端返回的商家转账确认参数。 */
export interface MerchantTransferPackage {
  mch_id: string
  app_id: string
  package: string
}

export type MerchantTransferResult = 'shown' | 'cancelled' | 'failed' | 'unsupported'

/**
 * 拉起微信「确认收款」页。'shown' 只表示用户在页面里操作完了，
 * 是否到账以后端查单为准。
 */
export function requestMerchantTransfer(info: MerchantTransferPackage): Promise<MerchantTransferResult> {
  if (typeof wx === 'undefined' || !wx.canIUse?.('requestMerchantTransfer')) {
    return Promise.resolve('unsupported')
  }
  return new Promise(resolve => {
    wx.requestMerchantTransfer({
      mchId: info.mch_id,
      appId: info.app_id,
      package: info.package,
      success: () => resolve('shown'),
      fail: (res: { errMsg?: string }) => resolve(/cancel/i.test(res?.errMsg || '') ? 'cancelled' : 'failed'),
    })
  })
}
