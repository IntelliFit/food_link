import { BALANCED_THEME_DEFINITIONS, type BalancedThemeId } from './balanced-theme'
import * as assets from '../mode-introduction-assets.json'

export type ModeIntroductionChoice = { mode: 'balanced'; theme: BalancedThemeId } | { mode: 'wellness' }
export const MODE_INTRODUCTION_CHAPTERS = assets.items.map((asset, index) => ({
  ...asset,
  choice: index < 8 ? { mode: 'balanced' as const, theme: BALANCED_THEME_DEFINITIONS[index].id } : { mode: 'wellness' as const },
  background: ['#fbfbf7', '#f3efe2', '#eee9dc', '#f4f1e9', '#f6ecdb', '#10202b', '#fffef8', '#091723', '#f7f7f3', '#f4f2e9'][index],
  accent: ['#b6ed00', '#4e7755', '#25281f', '#ed2818', '#28788b', '#ac562b', '#f7ba00', '#75b6ce', '#141616', '#1b4d37'][index],
  dark: index === 5 || index === 7,
}))

export const INTRODUCTION_FEATURES = [
  ['营养层级清晰', '记录入口直接', '重点信息突出'],
  ['植物标本意象', '叶脉纸笺层次', '柔和自然配色'],
  ['宋式手卷构图', '清供食器意象', '含蓄留白节奏'],
  ['撕纸拼贴层次', '红蓝撞色表达', '食物也是创作'],
  ['立体花园沙盘', '场景路牌导航', '探索式视觉层次'],
  ['晨昏三幕叙事', '日常章节回看', '温暖的陪伴氛围'],
  ['大字清晰可读', '高对比更醒目', '入口直接好找'],
  ['真实水光影像', '克制暗色空间', '从容观察变化'],
  ['阴阳水墨意象', '一餐一饮记录', '健康与阶段回顾'],
] as const

export const INTRODUCTION_CHOICE_RECTS = [
  [47, 359, 373, 218], [432, 359, 376, 218], [47, 584, 373, 220], [432, 584, 376, 220],
  [47, 811, 373, 225], [432, 811, 376, 225], [47, 1042, 373, 226], [432, 1042, 376, 226], [47, 1369, 761, 164],
] as const
export const INTRODUCTION_RADIOS = [[388, 548], [775, 548], [388, 776], [775, 776], [388, 1005], [775, 1005], [388, 1234], [775, 1234], [775, 1451]] as const
