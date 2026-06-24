import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { absoluteUrl, resolvePageSeo, siteSeo } from '@/content/seo'

const STRUCTURED_DATA_ID = 'structured-data'
const GLOBAL_HEAD_CONFIG_ID = 'globalHeadConfig'

function upsertMeta(selector: string, create: () => HTMLMetaElement, content: string) {
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

function upsertScript(id: string, type: string, textContent: string) {
  let el = document.getElementById(id) as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.id = id
    el.type = type
    document.head.appendChild(el)
  }
  el.type = type
  el.textContent = textContent
}

function buildStructuredData(pathname: string) {
  const page = resolvePageSeo(pathname)
  const pageUrl = absoluteUrl(page.path)

  if (page.path === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          url: absoluteUrl('/'),
          name: siteSeo.siteName,
          alternateName: siteSeo.fullName,
          description: siteSeo.defaultDescription,
          inLanguage: 'zh-CN',
          publisher: {
            '@id': `${absoluteUrl('/')}#organization`,
          },
        },
        {
          '@type': 'Organization',
          '@id': `${absoluteUrl('/')}#organization`,
          name: siteSeo.author,
          alternateName: siteSeo.fullName,
          url: absoluteUrl('/'),
          logo: {
            '@type': 'ImageObject',
            url: siteSeo.ogImage,
          },
          image: siteSeo.ogImage,
        },
        {
          '@type': 'SoftwareApplication',
          name: siteSeo.fullName,
          applicationCategory: 'HealthApplication',
          operatingSystem: 'WeChat Mini Program',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'CNY',
          },
          description: siteSeo.defaultDescription,
          url: pageUrl,
          image: siteSeo.ogImage,
        },
      ],
    }
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url: pageUrl,
    name: page.title,
    description: page.description,
    image: page.image ?? siteSeo.ogImage,
    inLanguage: 'zh-CN',
    isPartOf: {
      '@type': 'WebSite',
      url: absoluteUrl('/'),
      name: siteSeo.siteName,
    },
  }
}

function buildGlobalHeadConfig(pathname: string) {
  const page = resolvePageSeo(pathname)
  const pageUrl = absoluteUrl(page.path)
  const image = page.image ?? siteSeo.ogImage

  return {
    site_name: siteSeo.siteName,
    site_url: absoluteUrl('/'),
    title: page.title,
    author: siteSeo.author,
    description: page.description,
    keywords: page.keywords ?? siteSeo.keywords,
    og: {
      url: pageUrl,
      site_name: siteSeo.siteName,
      title: page.title,
      description: page.description,
      cover_image: image,
    },
    structured: buildStructuredData(pathname),
  }
}

/** 按路由同步 document title、meta、canonical 与 JSON-LD */
export function PageHead() {
  const { pathname } = useLocation()

  useEffect(() => {
    const page = resolvePageSeo(pathname)
    const pageUrl = absoluteUrl(page.path)
    const robots = page.index === false ? 'noindex, nofollow' : 'index, follow'
    const image = page.image ?? siteSeo.ogImage
    const imageAlt = page.imageAlt ?? siteSeo.ogImageAlt
    const keywords = page.keywords ?? siteSeo.keywords

    document.documentElement.lang = 'zh-CN'
    document.title = page.title

    upsertMeta('meta[name="description"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'description'
      return meta
    }, page.description)

    upsertMeta('meta[name="keywords"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'keywords'
      return meta
    }, keywords)

    upsertMeta('meta[name="author"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'author'
      return meta
    }, siteSeo.author)

    upsertMeta('meta[name="application-name"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'application-name'
      return meta
    }, siteSeo.siteName)

    upsertMeta('meta[name="apple-mobile-web-app-title"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'apple-mobile-web-app-title'
      return meta
    }, siteSeo.siteName)

    upsertMeta('meta[name="robots"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'robots'
      return meta
    }, robots)

    upsertMeta('meta[property="og:title"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:title')
      return meta
    }, page.title)

    upsertMeta('meta[property="og:description"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:description')
      return meta
    }, page.description)

    upsertMeta('meta[property="og:url"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:url')
      return meta
    }, pageUrl)

    upsertMeta('meta[property="og:type"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:type')
      return meta
    }, page.ogType ?? 'website')

    upsertMeta('meta[property="og:site_name"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:site_name')
      return meta
    }, siteSeo.siteName)

    upsertMeta('meta[property="og:locale"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:locale')
      return meta
    }, 'zh_CN')

    upsertMeta('meta[property="og:image"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:image')
      return meta
    }, image)

    upsertMeta('meta[property="og:image:alt"]', () => {
      const meta = document.createElement('meta')
      meta.setAttribute('property', 'og:image:alt')
      return meta
    }, imageAlt)

    upsertMeta('meta[name="twitter:card"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:card'
      return meta
    }, 'summary_large_image')

    upsertMeta('meta[name="twitter:title"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:title'
      return meta
    }, page.title)

    upsertMeta('meta[name="twitter:description"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:description'
      return meta
    }, page.description)

    upsertMeta('meta[name="twitter:image"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:image'
      return meta
    }, image)

    upsertMeta('meta[name="twitter:site"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:site'
      return meta
    }, siteSeo.twitterSite)

    upsertMeta('meta[name="twitter:url"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'twitter:url'
      return meta
    }, pageUrl)

    upsertMeta('meta[name="theme-color"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'theme-color'
      return meta
    }, siteSeo.themeColor)

    upsertLink('canonical', pageUrl)
    upsertScript(GLOBAL_HEAD_CONFIG_ID, 'text/javascript', `window._globalHeadConfig = ${JSON.stringify(buildGlobalHeadConfig(pathname))}`)
    upsertScript(STRUCTURED_DATA_ID, 'application/ld+json', JSON.stringify(buildStructuredData(pathname)))
  }, [pathname])

  return null
}
