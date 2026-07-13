import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import './index.scss'

interface CampusMembershipGateProps {
  loading?: boolean
  title?: string
  subtitle?: string
}

export default function CampusMembershipGate({
  loading = false,
  title = '校园食堂为会员专属',
  subtitle = '开通食探会员后，可以查看校园食堂菜品、筛选食堂窗口，并提交校园菜品。',
}: CampusMembershipGateProps) {
  const goMembership = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/pro-membership/index')}?source=campus_canteen` })
  }

  if (loading) {
    return (
      <View className='campus-membership-gate campus-membership-gate--loading'>
        <View className='campus-membership-gate__spinner' />
      </View>
    )
  }

  return (
    <View className='campus-membership-gate'>
      <View className='campus-membership-gate__card'>
        <View className='campus-membership-gate__icon'>
          <Text className='iconfont icon-shiwu' />
        </View>
        <Text className='campus-membership-gate__title'>{title}</Text>
        <Text className='campus-membership-gate__subtitle'>{subtitle}</Text>
        <View className='campus-membership-gate__button' onClick={goMembership}>
          <Text className='campus-membership-gate__button-text'>开通会员</Text>
        </View>
      </View>
    </View>
  )
}
