import type { OnboardingGuideStep } from '../../../components/OnboardingGuide/types'

export const ANALYZE_PREP_ONBOARDING_STEPS: OnboardingGuideStep[] = [
  {
    selector: '#analyze-guide-quality-zone',
    title: '识别质量设置',
    description: '这里选择快速、普通或精准识别；AI 摄入比例等开关收在「更多设置」里，平时不用改。',
    padding: 12,
    scrollIntoView: false,
  },
  {
    selector: '.analyze-page .details-section',
    title: '文字补充',
    description: '若有特殊烹饪方式、份量或包装信息，可在此用文字补充，帮助 AI 识别更准确。',
    padding: 12,
    scrollIntoView: false,
  },
]
