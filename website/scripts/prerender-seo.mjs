import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')
const indexHtmlPath = path.join(distDir, 'index.html')
const siteUrl = (process.env.VITE_SITE_URL || 'https://healthymax.cn').replace(/\/$/, '')
const today = new Date().toISOString().slice(0, 10)
const defaultOgImage = `${siteUrl}/images/shouye.jpg`
const defaultImageAlt = '食探官网首页饮食分析与记录界面预览'
const author = '智健启能（北京）科技有限公司'
const siteName = '食探'
const fullName = '智健食探'

const routeConfigs = [
  {
    path: '/',
    title: '食探丨记录饮食，连接健康',
    description: '智健食探（Food Link）— AI 帮你看懂每一餐。智能饮食记录、热量分析与营养洞察，微信小程序即刻体验。',
    keywords: '食探,智健食探,Food Link,饮食记录,热量计算,营养分析,AI健康管理,微信小程序,减脂,健康饮食',
    ogType: 'website',
    index: true,
  },
  {
    path: '/about',
    title: '关于我们丨智健食探',
    description: '了解智健食探：AI 驱动的饮食健康管理小程序，帮助用户拍照识热量、记录饮食与运动。由智健启能（北京）科技有限公司提供产品与技术支持。',
    keywords: '食探,智健食探,Food Link,关于我们,AI 饮食健康管理',
    ogType: 'website',
    index: true,
  },
  {
    path: '/blog',
    title: '博客丨智健食探',
    description: '智健食探官方博客，分享健康饮食、营养科学与产品更新。',
    keywords: '食探,智健食探,健康饮食博客,营养知识,产品更新',
    ogType: 'website',
    index: false,
  },
  {
    path: '/agreement',
    title: '用户协议丨智健食探',
    description: '智健食探用户服务协议与使用条款。',
    keywords: '食探,智健食探,用户协议,服务条款',
    ogType: 'website',
    index: true,
  },
  {
    path: '/privacy',
    title: '隐私政策丨智健食探',
    description: '智健食探隐私政策，说明我们如何收集、使用与保护您的个人信息。',
    keywords: '食探,智健食探,隐私政策,个人信息保护',
    ogType: 'website',
    index: true,
  },
  {
    path: '/developer',
    title: '食探开放平台丨API 与 MCP',
    description: '通过食探开放平台 API 与 MCP，为 Agent、应用和硬件接入食物识别与可信营养数据。',
    keywords: '食探,食物识别API,营养API,MCP,AI Agent,硬件接入',
    ogType: 'website',
    index: true,
  },
  {
    path: '/developer/docs',
    title: '食探开放平台开发文档丨API 参数与 MCP',
    description: '食探开放平台完整开发文档：图片上传、普通与精准食物识别、文字分析、营养搜索、异步任务、计费和 MCP 接入。',
    keywords: '食探,食物识别API文档,营养API参数,MCP文档,图片识别API,AI Agent',
    ogType: 'website',
    index: true,
  },
  {
    path: '/developer/console',
    title: '开发者控制台丨智健食探',
    description: '管理食探开放平台应用、API Key、点数和充值订单。',
    keywords: '食探,开放平台,开发者控制台,API Key',
    ogType: 'website',
    index: false,
  },
]

function absoluteUrl(routePath) {
  if (!routePath || routePath === '/') return siteUrl
  return `${siteUrl}${routePath.startsWith('/') ? routePath : `/${routePath}`}`
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003C')
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', '&quot;')
}

function buildStructuredData(route) {
  const pageUrl = absoluteUrl(route.path)
  if (route.path === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          url: pageUrl,
          name: siteName,
          alternateName: fullName,
          description: route.description,
          inLanguage: 'zh-CN',
          publisher: {
            '@id': `${siteUrl}#organization`,
          },
        },
        {
          '@type': 'Organization',
          '@id': `${siteUrl}#organization`,
          name: author,
          alternateName: fullName,
          url: siteUrl,
          logo: {
            '@type': 'ImageObject',
            url: defaultOgImage,
          },
        },
        {
          '@type': 'SoftwareApplication',
          name: fullName,
          applicationCategory: 'HealthApplication',
          operatingSystem: 'WeChat Mini Program',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'CNY',
          },
          description: route.description,
          url: pageUrl,
          image: defaultOgImage,
        },
      ],
    }
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url: pageUrl,
    name: route.title,
    description: route.description,
    image: defaultOgImage,
    inLanguage: 'zh-CN',
    isPartOf: {
      '@type': 'WebSite',
      url: siteUrl,
      name: siteName,
    },
  }
}

function buildGlobalHeadConfig(route) {
  const pageUrl = absoluteUrl(route.path)
  return {
    site_name: siteName,
    site_url: siteUrl,
    title: route.title,
    author,
    description: route.description,
    keywords: route.keywords,
    og: {
      url: pageUrl,
      site_name: siteName,
      title: route.title,
      description: route.description,
      cover_image: defaultOgImage,
    },
    structured: buildStructuredData(route),
  }
}

function replaceTag(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    throw new Error(`Missing ${label} in dist/index.html`)
  }
  return html.replace(pattern, replacement)
}

function injectSeo(html, route) {
  const pageUrl = absoluteUrl(route.path)
  const robots = route.index === false ? 'noindex, nofollow' : 'index, follow'
  const structuredJson = scriptJson(buildStructuredData(route))
  const globalHeadConfig = scriptJson(buildGlobalHeadConfig(route))

  let output = html
  output = replaceTag(output, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(route.title)}</title>`, 'title')
  output = replaceTag(output, /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeAttr(route.description)}" />`, 'description')
  output = replaceTag(output, /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/i, `<meta name="keywords" content="${escapeAttr(route.keywords)}" />`, 'keywords')
  output = replaceTag(output, /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i, `<meta name="robots" content="${robots}" />`, 'robots')
  output = replaceTag(output, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${pageUrl}" />`, 'canonical')
  output = replaceTag(output, /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escapeAttr(route.title)}" />`, 'og:title')
  output = replaceTag(output, /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:type" content="${route.ogType}" />`, 'og:type')
  output = replaceTag(output, /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${escapeAttr(route.description)}" />`, 'og:description')
  output = replaceTag(output, /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${pageUrl}" />`, 'og:url')
  output = replaceTag(output, /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${defaultOgImage}" />`, 'og:image')
  output = replaceTag(output, /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image:alt" content="${defaultImageAlt}" />`, 'og:image:alt')
  output = replaceTag(output, /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${escapeAttr(route.title)}" />`, 'twitter:title')
  output = replaceTag(output, /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${escapeAttr(route.description)}" />`, 'twitter:description')
  output = replaceTag(output, /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${defaultOgImage}" />`, 'twitter:image')
  output = replaceTag(output, /<meta\s+name="twitter:url"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:url" content="${pageUrl}" />`, 'twitter:url')
  output = replaceTag(output, /<script\s+type="text\/javascript"\s+id="globalHeadConfig">[\s\S]*?<\/script>/i, `<script type="text/javascript" id="globalHeadConfig">window._globalHeadConfig = ${globalHeadConfig}</script>`, 'globalHeadConfig')
  output = replaceTag(output, /<script\s+type="application\/ld\+json"\s+id="structured-data">[\s\S]*?<\/script>/i, `<script type="application/ld+json" id="structured-data">${structuredJson}</script>`, 'structured-data')
  return output
}

function buildSitemap(routes) {
  const body = routes
    .filter((route) => route.index !== false)
    .map((route) => `  <url>
    <loc>${route.path === '/' ? `${siteUrl}/` : absoluteUrl(route.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${route.path === '/' ? 'weekly' : route.path === '/about' ? 'monthly' : 'yearly'}</changefreq>
    <priority>${route.path === '/' ? '1.0' : route.path === '/about' ? '0.7' : '0.3'}</priority>
  </url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

const baseHtml = await fs.readFile(indexHtmlPath, 'utf8')

for (const route of routeConfigs) {
  const renderedHtml = injectSeo(baseHtml, route)
  const targetPath = route.path === '/'
    ? indexHtmlPath
    : path.join(distDir, route.path.replace(/^\/+/, ''), 'index.html')
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, renderedHtml, 'utf8')
}

await fs.writeFile(path.join(distDir, 'sitemap.xml'), buildSitemap(routeConfigs), 'utf8')

const openApiSource = path.resolve(__dirname, '..', '..', 'docs', 'openapi', 'foodlink-openapi-v1.yaml')
const openApiTarget = path.join(distDir, 'openapi', 'foodlink-openapi-v1.yaml')
await fs.mkdir(path.dirname(openApiTarget), { recursive: true })
await fs.copyFile(openApiSource, openApiTarget)

const aiGuideSource = path.resolve(__dirname, '..', '..', 'docs', 'ai', 'foodlink-ai-integration.md')
const aiGuideTarget = path.join(distDir, 'developer', 'ai-guide.md')
await fs.mkdir(path.dirname(aiGuideTarget), { recursive: true })
await fs.copyFile(aiGuideSource, aiGuideTarget)

const llmsSource = path.resolve(__dirname, '..', '..', 'docs', 'ai', 'llms.txt')
await fs.copyFile(llmsSource, path.join(distDir, 'llms.txt'))

const mcpReadmeSource = path.resolve(__dirname, '..', '..', 'integrations', 'foodlink-mcp', 'README.md')
await fs.copyFile(mcpReadmeSource, path.join(distDir, 'developer', 'mcp-readme.md'))

const mcpRoot = path.resolve(__dirname, '..', '..', 'integrations', 'foodlink-mcp')
const mcpPackage = JSON.parse(await fs.readFile(path.join(mcpRoot, 'package.json'), 'utf8'))
const mcpBundleFiles = [
  'README.md',
  'package.json',
  'src/client.mjs',
  'src/server.mjs',
  'examples/codex-config.toml',
  'examples/mcp-config.json',
  'examples/test-api.ps1',
  'test/client.test.mjs',
  'test/server.test.mjs',
]
const deterministicMtime = new Date('2020-01-01T00:00:00.000Z')
const mcpZipEntries = {}
for (const relativePath of mcpBundleFiles) {
  mcpZipEntries[`foodlink-mcp/${relativePath}`] = [
    await fs.readFile(path.join(mcpRoot, relativePath)),
    { mtime: deterministicMtime },
  ]
}

const mcpZip = zipSync(mcpZipEntries, { level: 9 })
const mcpSha256 = createHash('sha256').update(mcpZip).digest('hex')
const mcpFileName = `foodlink-mcp-v${mcpPackage.version}.zip`
const downloadsDir = path.join(distDir, 'downloads')
await fs.mkdir(downloadsDir, { recursive: true })
await fs.writeFile(path.join(downloadsDir, mcpFileName), mcpZip)
await fs.writeFile(path.join(downloadsDir, 'foodlink-mcp-latest.zip'), mcpZip)
await fs.writeFile(path.join(downloadsDir, `${mcpFileName}.sha256`), `${mcpSha256}  ${mcpFileName}\n`, 'utf8')
await fs.writeFile(path.join(downloadsDir, 'foodlink-mcp-latest.zip.sha256'), `${mcpSha256}  foodlink-mcp-latest.zip\n`, 'utf8')
await fs.writeFile(path.join(downloadsDir, 'foodlink-mcp-manifest.json'), `${JSON.stringify({
  name: mcpPackage.name,
  version: mcpPackage.version,
  format: 'zip',
  file: mcpFileName,
  url: `${siteUrl}/downloads/${mcpFileName}`,
  latest_url: `${siteUrl}/downloads/foodlink-mcp-latest.zip`,
  sha256: mcpSha256,
  bytes: mcpZip.byteLength,
  node: mcpPackage.engines?.node || '>=20',
  api_base_url: 'https://api.healthymax.cn/open/v1',
  docs_url: `${siteUrl}/developer/mcp-readme.md`,
}, null, 2)}\n`, 'utf8')
