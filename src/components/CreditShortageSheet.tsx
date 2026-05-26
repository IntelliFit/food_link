import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { MembershipStatus } from '../utils/api'
import { buildCreditShortageInfo } from '../utils/membership'
import { extraPkgUrl } from '../utils/subpackage-extra'

import './CreditShortageSheet.scss'

interface CreditShortageSheetProps {
  visible: boolean
  membershipStatus?: MembershipStatus | null
  requiredCredits: number
  scenarioLabel?: string
  message?: string
  onClose: () => void
}

function CreditShortageSheet({
  visible,
  membershipStatus,
  requiredCredits,
  scenarioLabel,
  message,
  onClose,
}: CreditShortageSheetProps) {
  if (!visible) return null

  const info = buildCreditShortageInfo(membershipStatus, {
    requiredCredits,
    scenarioLabel,
    message,
  })

  const navigateToRewardCenter = () => {
    onClose()
    Taro.navigateTo({ url: extraPkgUrl('/pages/reward-center/index') })
  }

  const navigateToMembership = () => {
    onClose()
    Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
  }

  return (
    <View className='credit-shortage-sheet' catchMove>
      <View className='credit-shortage-sheet__mask' onClick={onClose} />
      <View className='credit-shortage-sheet__panel'>
        <View className='credit-shortage-sheet__handle' />
        <View className='credit-shortage-sheet__header'>
          <View>
            <Text className='credit-shortage-sheet__eyebrow'>奖励积分可继续累计使用</Text>
            <Text className='credit-shortage-sheet__title'>积分不够啦</Text>
          </View>
          <View className='credit-shortage-sheet__close' onClick={onClose}>
            <Text className='credit-shortage-sheet__close-text'>×</Text>
          </View>
        </View>

        <Text className='credit-shortage-sheet__message'>{info.message}</Text>

        <View className='credit-shortage-sheet__stats'>
          <View className='credit-shortage-sheet__stat'>
            <Text className='credit-shortage-sheet__stat-value'>{info.totalAvailable}</Text>
            <Text className='credit-shortage-sheet__stat-label'>当前可用</Text>
          </View>
          <View className='credit-shortage-sheet__stat'>
            <Text className='credit-shortage-sheet__stat-value'>{info.systemRemaining}</Text>
            <Text className='credit-shortage-sheet__stat-label'>系统剩余</Text>
          </View>
          <View className='credit-shortage-sheet__stat'>
            <Text className='credit-shortage-sheet__stat-value'>{info.earnedBalance}</Text>
            <Text className='credit-shortage-sheet__stat-label'>奖励余额</Text>
          </View>
          <View className='credit-shortage-sheet__stat credit-shortage-sheet__stat--need'>
            <Text className='credit-shortage-sheet__stat-value'>{info.requiredCredits}</Text>
            <Text className='credit-shortage-sheet__stat-label'>本次需要</Text>
          </View>
        </View>

        <View className='credit-shortage-sheet__actions'>
          <View className='credit-shortage-sheet__primary' onClick={navigateToRewardCenter}>
            <Text className='credit-shortage-sheet__primary-text'>去赚积分</Text>
          </View>
          <View className='credit-shortage-sheet__secondary' onClick={navigateToMembership}>
            <Text className='credit-shortage-sheet__secondary-text'>{info.membershipActionText}</Text>
          </View>
        </View>

        <View className='credit-shortage-sheet__later' onClick={onClose}>
          <Text className='credit-shortage-sheet__later-text'>稍后再说</Text>
        </View>
      </View>
    </View>
  )
}

export default CreditShortageSheet
