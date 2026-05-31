import { brand } from '@/content/brand'

/** 官网 canonical 根域名，部署后可通过 Vite 环境变量覆盖 */
export const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://healthymax.cn'

export const siteSeo = {
  siteName: brand.shortName,
  fullName: brand.fullName,
  author: brand.companyName,
  defaultTitle: `${brand.shortName}丨${brand.slogan}`,
  defaultDescription: `${brand.fullName}（${brand.legalName}）— ${brand.subSlogan}。AI 智能饮食记录、热量分析与营养洞察，微信小程序即刻体验。`,
  keywords: [
    brand.shortName,
    brand.fullName,
    brand.legalName,
    '饮食记录',
    '热量计算',
    '营养分析',
    'AI 健康管理',
    '微信小程序',
    '减脂',
    '健康饮食',
  ].join(','),
  themeColor: '#00bc7d',
  ogImage: `${SITE_URL}/brand/logo-shitan.png`,
  twitterSite: '@healthymax',
} as const

export type PageSeoConfig = {
  title: string
  description: string
  path: string
  /** 是否允许索引，默认 true */
  index?: boolean
  ogType?: 'website' | 'article'
}

export const pageSeoByPath: Record<string, PageSeoConfig> = {
  '/': {
    title: siteSeo.defaultTitle,
    description: siteSeo.defaultDescription,
    path: '/',
    ogType: 'website',
  },
  '/about': {
    title: `关于我们丨${brand.fullName}`,
    description: `了解${brand.fullName}：AI 驱动的饮食健康管理小程序，帮助用户拍照识热量、记录饮食与运动。由${brand.companyName}提供产品与技术支持。`,
    path: '/about',
  },
  '/blog': {
    title: `博客丨${brand.fullName}`,
    description: `${brand.fullName}官方博客，分享健康饮食、营养科学与产品更新。`,
    path: '/blog',
  },
  '/agreement': {
    title: `用户协议丨${brand.fullName}`,
    description: `${brand.fullName}用户服务协议与使用条款。`,
    path: '/agreement',
  },
  '/privacy': {
    title: `隐私政策丨${brand.fullName}`,
    description: `${brand.fullName}隐私政策，说明我们如何收集、使用与保护您的个人信息。`,
    path: '/privacy',
  },
}

/** 构建 sitemap 用的公开路由 */
export const publicRoutes = Object.keys(pageSeoByPath)

export function resolvePageSeo(pathname: string): PageSeoConfig {
  return pageSeoByPath[pathname] ?? pageSeoByPath['/']
}

export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL.replace(/\/$/, '')}${normalized}`
}
