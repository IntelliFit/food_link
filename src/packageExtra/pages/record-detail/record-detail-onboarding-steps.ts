import Taro from '@tarojs/taro'
import type { OnboardingGuideStep } from '../../../components/OnboardingGuide/types'

export const RECORD_DETAIL_ONBOARDING_STEPS: OnboardingGuideStep[] = [
  {
    title: '已发布到圈子',
    description:
      '你的饮食记录已同步到圈子动态，其他用户可以在圈子里看到这条记录。如不想自动发布，可前往【我的】-【隐私设置】关闭。',
    confirmLabel: '知道了',
    action: {
      label: '去圈子看看',
      onPress: () => {
        Taro.switchTab({ url: '/pages/community/index' })
      },
    },
  },
]
