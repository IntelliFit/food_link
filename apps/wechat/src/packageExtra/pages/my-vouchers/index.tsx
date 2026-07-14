import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

import './index.scss'

function MyVouchersPage() {
  useDidShow(() => {
    Taro.redirectTo({
      url: extraPkgUrl('/pages/reward-center/index?section=rewards'),
      fail: (error) => {
        console.error('[legacy-my-vouchers] redirect failed:', error)
        Taro.showToast({ title: '页面跳转失败', icon: 'none' })
      },
    })
  })

  // 保留旧路由只为兼容历史系统消息和旧版本缓存，产品入口统一回到“赚积分”。
  return <View />
}

export default MyVouchersPage
