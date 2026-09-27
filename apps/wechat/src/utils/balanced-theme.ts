import Taro from '@tarojs/taro'

export const BALANCED_THEME_STORAGE_KEY = 'balanced_visual_theme_v1'

export const BALANCED_THEME_IDS = [
  'clarity-order',
  'natural-symbiosis',
  'eastern-salon',
  'modern-gallery',
  'miniature-world',
  'picturebook-companion',
  'clear-care',
  'way-of-water',
] as const

export type BalancedThemeId = typeof BALANCED_THEME_IDS[number]

export type BalancedThemeDefinition = {
  id: BalancedThemeId
  name: string
  subtitle: string
  audience: string
  signature: string
  interactionHint: string
  toolboxLabel: string
  toolboxIconClass: string
  swatches: readonly [string, string, string]
}

export const BALANCED_THEME_DEFINITIONS: readonly BalancedThemeDefinition[] = [
  {
    id: 'clarity-order',
    name: '澄明秩序',
    subtitle: '清晰栅格 · 高效阅读',
    audience: '适合重视效率与数据层级的你',
    signature: '瑞士栅格与可重排信息索引',
    interactionHint: '轻触重排信息索引',
    toolboxLabel: '模块抽屉',
    toolboxIconClass: 'icon-all',
    swatches: ['#f7f7f3', '#111111', '#c8ff00'],
  },
  {
    id: 'natural-symbiosis',
    name: '自然共生',
    subtitle: '植物纤维 · 四季生长',
    audience: '适合喜欢植物与轻疗愈体验的你',
    signature: '会随触碰生长的叶脉年轮',
    interactionHint: '轻触让叶片生长',
    toolboxLabel: '种子匣',
    toolboxIconClass: 'icon-a-144-lvye',
    swatches: ['#f3efe2', '#274f37', '#79a98a'],
  },
  {
    id: 'eastern-salon',
    name: '东方雅集',
    subtitle: '宋式卷轴 · 瓷漆雅韵',
    audience: '适合偏爱含蓄东方审美的你',
    signature: '可展开的宋式生活手卷',
    interactionHint: '轻触展开生活手卷',
    toolboxLabel: '漆艺屉柜',
    toolboxIconClass: 'icon-foodshop',
    swatches: ['#eee9dc', '#151515', '#9aa99a'],
  },
  {
    id: 'modern-gallery',
    name: '现代艺廊',
    subtitle: '撕纸拼贴 · 强烈表达',
    audience: '适合追求先锋艺术与个性的你',
    signature: '可以重新组合的撕纸作品',
    interactionHint: '轻触重组拼贴作品',
    toolboxLabel: '档案匣',
    toolboxIconClass: 'icon-picture',
    swatches: ['#f4f1e9', '#173eb5', '#e83b24'],
  },
  {
    id: 'miniature-world',
    name: '微缩世界',
    subtitle: '立体沙盘 · 探索路径',
    audience: '适合喜欢探索、收藏和空间故事的你',
    signature: '可行走的立体饮食沙盘',
    interactionHint: '轻触移动旅行标记',
    toolboxLabel: '旅行柜',
    toolboxIconClass: 'icon-dizhi',
    swatches: ['#ead8b7', '#4c7561', '#3687a6'],
  },
  {
    id: 'picturebook-companion',
    name: '绘本陪伴',
    subtitle: '电影分镜 · 日常叙事',
    audience: '适合重视情绪陪伴与生活故事的你',
    signature: '一天一章的电影感翻页',
    interactionHint: '轻触翻开下一章节',
    toolboxLabel: '帆布功能袋',
    toolboxIconClass: 'icon-shuben',
    swatches: ['#e8d6b8', '#24384a', '#a75536'],
  },
  {
    id: 'clear-care',
    name: '清朗关怀',
    subtitle: '大字高对比 · 轻松操作',
    audience: '适合希望阅读直接、操作省力的你',
    signature: '三段直达的大字专注界面',
    interactionHint: '轻触切换阅读重点',
    toolboxLabel: '功能面板',
    toolboxIconClass: 'icon-juzhong',
    swatches: ['#ffffff', '#005b38', '#f5ad19'],
  },
  {
    id: 'way-of-water',
    name: '水之道',
    subtitle: '随形而行 · 静观变化',
    audience: '适合喜欢哲学、冥想与抽象艺术的你',
    signature: '可触发涟漪的流动时间线',
    interactionHint: '轻触水面观察变化',
    toolboxLabel: '流动匣',
    toolboxIconClass: 'icon-drink',
    swatches: ['#09131d', '#274b66', '#d06f3f'],
  },
] as const

export const DEFAULT_BALANCED_THEME: BalancedThemeId = 'clarity-order'

export function isBalancedThemeId(value: unknown): value is BalancedThemeId {
  return typeof value === 'string' && BALANCED_THEME_IDS.includes(value as BalancedThemeId)
}

export function getBalancedThemeDefinition(id: BalancedThemeId): BalancedThemeDefinition {
  return BALANCED_THEME_DEFINITIONS.find((theme) => theme.id === id) ?? BALANCED_THEME_DEFINITIONS[0]
}

export function getStoredBalancedTheme(): BalancedThemeId {
  try {
    const value = Taro.getStorageSync(BALANCED_THEME_STORAGE_KEY)
    return isBalancedThemeId(value) ? value : DEFAULT_BALANCED_THEME
  } catch {
    return DEFAULT_BALANCED_THEME
  }
}

export function setStoredBalancedTheme(theme: BalancedThemeId): void {
  try {
    Taro.setStorageSync(BALANCED_THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore storage errors */
  }
}
