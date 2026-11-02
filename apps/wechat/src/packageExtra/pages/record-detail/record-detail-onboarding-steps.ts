import Taro from '@tarojs/taro'
import type { OnboardingGuideStep } from '../../../components/OnboardingGuide/types'

export const RECORD_DETAIL_ONBOARDING_STEPS: OnboardingGuideStep[] = [
  {
    title: '已同步到圈子',
    description:
      '这条记录是你选择同步的，所有用户都能在圈子看到。不想同步时，保存前关闭开关即可；也可以前往【我的】-【隐私设置】关闭公开。',
    confirmLabel: '知道了',
    action: {
      label: '去圈子看看',
      onPress: () => {
        Taro.switchTab({ url: '/pages/community/index' })
      },
    },
  },
]
