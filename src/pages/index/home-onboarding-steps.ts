import type { OnboardingGuideStep } from '../../components/OnboardingGuide/types'

export const HOME_RECORD_ONBOARDING_STEPS: OnboardingGuideStep[] = [
  {
    preset: 'tab-record-center',
    title: '从这里开始记录',
    description: '点击底部按钮进行热量记录',
    padding: 6,
  },
  {
    selector: '#record-menu-guide-camera',
    title: '拍照识别',
    description: '点击拍照识别，可以直接对准实物进行拍摄，AI 会自动识别热量与营养成分。',
    padding: 10,
  },
  {
    selector: '#record-menu-guide-album',
    title: '相册上传',
    description: '如果你的相册里已经有想要提交的图片，则可以选择该功能。最多可同时上传 3 张，作为一次识别提交。',
    padding: 10,
  },
  {
    selector: '#record-menu-guide-text',
    title: '文本输入',
    description: '用文字描述吃了什么，适合不方便拍照的场景。比如你吃了一份人均100元的海底捞。',
    padding: 10,
  },
  {
    selector: '#record-menu-guide-manual',
    title: '食物库输入',
    description: '从食物库中挑选常见食物直接记录，无需拍照或打字。比如你喝了一瓶统一冰红茶，或者吃了一碗标准白米饭。',
    padding: 10,
  },
]
