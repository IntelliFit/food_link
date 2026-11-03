import Taro from '@tarojs/taro'
import type { OnboardingGuideStep } from '../../../components/OnboardingGuide/types'

export const RECORD_DETAIL_ONBOARDING_STEPS: OnboardingGuideStep[] = [
  {
    title: '已同步到圈子',
    description:
      '你开启了“允许陌生人看到”，所有用户都能在圈子看到这条记录。可以前往【我的】-【隐私设置】修改。',
    confirmLabel: '知道了',
    action: {
      label: '去圈子看看',
      onPress: () => {
        Taro.switchTab({ url: '/pages/community/index' })
      },
    },
  },
]
