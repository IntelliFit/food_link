import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { absoluteUrl, resolvePageSeo, siteSeo } from '@/content/seo'

const STRUCTURED_DATA_ID = 'structured-data'

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

function upsertStructuredData(data: Record<string, unknown>) {
  let el = document.getElementById(STRUCTURED_DATA_ID) as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.id = STRUCTURED_DATA_ID
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

function buildStructuredData(pathname: string) {
  const page = resolvePageSeo(pathname)
  const pageUrl = absoluteUrl(page.path)

  if (pathname === '/') {
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
            '@type': 'Organization',
            name: siteSeo.author,
            url: absoluteUrl('/'),
            logo: siteSeo.ogImage,
          },
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
    inLanguage: 'zh-CN',
    isPartOf: {
      '@type': 'WebSite',
      url: absoluteUrl('/'),
      name: siteSeo.siteName,
    },
  }
}

/** 按路由同步 document title、meta、canonical 与 JSON-LD */
export function PageHead() {
  const { pathname } = useLocation()

  useEffect(() => {
    const page = resolvePageSeo(pathname)
    const pageUrl = absoluteUrl(page.path)
    const robots = page.index === false ? 'noindex, nofollow' : 'index, follow'

    document.title = page.title

    upsertMeta('meta[name="description"]', () => {
      const meta = document.createElement('meta')
      meta.name = 'description'
      return meta
    }, page.description)

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

    upsertLink('canonical', pageUrl)
    upsertStructuredData(buildStructuredData(pathname))
  }, [pathname])

  return null
}
