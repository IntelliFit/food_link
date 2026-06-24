import { brand } from '@/content/brand'

/** 官网 canonical 根域名，部署后可通过 Vite 环境变量覆盖 */
export const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://healthymax.cn'
export const DEFAULT_OG_IMAGE_PATH = '/images/shouye.jpg'

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
  ogImage: `${SITE_URL.replace(/\/$/, '')}${DEFAULT_OG_IMAGE_PATH}`,
  ogImageAlt: '食探官网首页饮食分析与记录界面预览',
  twitterSite: '@healthymax',
} as const

export type PageSeoConfig = {
  title: string
  description: string
  path: string
  /** 是否允许索引，默认 true */
  index?: boolean
  ogType?: 'website' | 'article'
  keywords?: string
  image?: string
  imageAlt?: string
}

export const pageSeoByPath: Record<string, PageSeoConfig> = {
  '/': {
    title: siteSeo.defaultTitle,
    description: siteSeo.defaultDescription,
    path: '/',
    ogType: 'website',
    image: siteSeo.ogImage,
    imageAlt: siteSeo.ogImageAlt,
  },
  '/about': {
    title: `关于我们丨${brand.fullName}`,
    description: `了解${brand.fullName}：AI 驱动的饮食健康管理小程序，帮助用户拍照识热量、记录饮食与运动。由${brand.companyName}提供产品与技术支持。`,
    path: '/about',
    keywords: `${brand.shortName},${brand.fullName},${brand.legalName},关于我们,AI 饮食健康管理`,
    image: siteSeo.ogImage,
    imageAlt: siteSeo.ogImageAlt,
  },
  '/blog': {
    title: `博客丨${brand.fullName}`,
    description: `${brand.fullName}官方博客，分享健康饮食、营养科学与产品更新。`,
    path: '/blog',
    keywords: `${brand.shortName},${brand.fullName},健康饮食博客,营养知识,产品更新`,
    index: false,
    image: siteSeo.ogImage,
    imageAlt: siteSeo.ogImageAlt,
  },
  '/agreement': {
    title: `用户协议丨${brand.fullName}`,
    description: `${brand.fullName}用户服务协议与使用条款。`,
    path: '/agreement',
    keywords: `${brand.shortName},${brand.fullName},用户协议,服务条款`,
    image: siteSeo.ogImage,
    imageAlt: siteSeo.ogImageAlt,
  },
  '/privacy': {
    title: `隐私政策丨${brand.fullName}`,
    description: `${brand.fullName}隐私政策，说明我们如何收集、使用与保护您的个人信息。`,
    path: '/privacy',
    keywords: `${brand.shortName},${brand.fullName},隐私政策,个人信息保护`,
    image: siteSeo.ogImage,
    imageAlt: siteSeo.ogImageAlt,
  },
}

const sharePageSeo: PageSeoConfig = {
  title: `饮食记录分享丨${brand.fullName}`,
  description: `${brand.fullName}饮食记录分享页，可查看餐次热量、营养结构与食物明细。`,
  path: '/share/food-record',
  index: false,
  ogType: 'website',
  keywords: `${brand.shortName},${brand.fullName},饮食记录分享,热量分析,营养结构`,
  image: siteSeo.ogImage,
  imageAlt: siteSeo.ogImageAlt,
}

/** 构建 sitemap 用的公开路由 */
export const publicRoutes = Object.values(pageSeoByPath)
  .filter((page) => page.index !== false)
  .map((page) => page.path)

function normalizePathname(pathname: string): string {
  if (!pathname) return '/'
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || '/'
  if (withoutQuery === '/') return '/'
  return withoutQuery.replace(/\/+$/, '') || '/'
}

export function resolvePageSeo(pathname: string): PageSeoConfig {
  const normalizedPath = normalizePathname(pathname)
  if (normalizedPath.startsWith('/share/food-record/')) {
    return { ...sharePageSeo, path: normalizedPath }
  }
  return pageSeoByPath[normalizedPath] ?? pageSeoByPath['/']
}

export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path
  const baseUrl = SITE_URL.replace(/\/$/, '')
  if (!path || path === '/') return baseUrl
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalized}`
}
