import type { LucideIcon } from 'lucide-react'
import { BarChart3, Flame, Users } from 'lucide-react'

export type FeatureBlock = {
  id: string
  badge: string
  title: string
  description: string
  highlights: string[]
  screenshotLabel: string
  screenshotSrc: string
  icon: LucideIcon
  emphasized?: boolean
}

export const hero = {
  eyebrow: '智健食探',
  title: '吃得明白。\n活得轻松。',
  description: '把每一餐变成可理解的健康选择。食探用 AI 帮你看懂自己吃了什么，而不是让你陷入繁琐的计算。',
  screenshotLabel: 'App 首页预览',
} as const

export const features: FeatureBlock[] = [
  {
    id: 'home',
    badge: '每日总览',
    title: '今天还能吃什么，\n一眼就有答案。',
    description:
      '热量与营养不再是一堆难懂的数字，而是你手边最清晰的提醒。吃得是否合适，当下就能感知。',
    highlights: ['剩余热量，直观呈现', '营养是否均衡，立刻知晓', '下一餐吃什么，更有方向'],
    screenshotLabel: '首页 · 能量分析',
    screenshotSrc: '/images/shouye.jpg',
    icon: Flame,
    emphasized: true,
  },
  {
    id: 'analysis',
    badge: '深度洞察',
    title: '不只是记录，\n更帮你读懂趋势。',
    description:
      '食探把零散的一餐一餐，汇成对你真正有用的健康反馈。你看到的，是方向，而不只是数据。',
    highlights: ['饮食表现，一屏掌握', '长期趋势，清晰可见', '改进建议，简单可执行'],
    screenshotLabel: '分析 · 健康评分',
    screenshotSrc: '/images/fenxi.jpg',
    icon: BarChart3,
  },
  {
    id: 'community',
    badge: '饮食圈子',
    title: '健康，\n不必一个人坚持。',
    description:
      '和志同道合的人一起记录、一起分享、一起变好。真实的生活感，比完美的打卡更重要。',
    highlights: ['和好友彼此看见进步', '真实分享，而非表演', '坚持，因为有人同行'],
    screenshotLabel: '圈子 · 饮食分享',
    screenshotSrc: '/images/quanzi.jpg',
    icon: Users,
  },
]

export const cta = {
  title: '从第一餐开始',
  description: '微信扫码，立即体验食探。把健康管理，变成每天都可以做到的事。',
} as const

export const appComingSoon = {
  eyebrow: 'App 下载',
  title: '食探 App，\n现在可以下载体验。',
  description:
    'Android 直装包适合手机直接安装体验；AAB 是应用商店上架包，保留给分发渠道和审核流程使用。',
} as const
