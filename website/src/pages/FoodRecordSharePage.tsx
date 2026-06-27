import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, Beef, Droplets, Flame, Smartphone, Wheat } from 'lucide-react'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { brand } from '@/content/brand'
import { absoluteUrl } from '@/content/seo'

type ApiEnvelope<T> = {
  code?: number
  message?: string
  data?: T
}

type SharedFoodRecordItem = {
  name?: string
  weight?: number
  intake?: number
  ratio?: number
  nutrients?: {
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    [key: string]: unknown
  }
}

type SharedFoodRecord = {
  id: string
  meal_type?: string
  description?: string | null
  insight?: string | null
  image_path?: string | null
  image_paths?: string[]
  record_time?: string | null
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  items?: SharedFoodRecordItem[]
}

type LoadState =
  | { status: 'loading'; requestKey: string }
  | { status: 'ready'; requestKey: string; record: SharedFoodRecord }
  | { status: 'error'; requestKey: string; title: string; message: string }

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.healthymax.cn'

const mealLabels: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
}

function resolveShareApiBaseUrl(searchParams: URLSearchParams): string {
  const apiEnv = String(searchParams.get('api_env') || '').trim().toLowerCase()
  if (apiEnv === 'dev' || apiEnv === 'trial' || apiEnv === 'develop') return 'https://dev.api.healthymax.cn'
  if (apiEnv === 'local') return 'http://127.0.0.1:3010'
  return DEFAULT_API_BASE_URL.replace(/\/+$/, '')
}

function unwrapRecordResponse(payload: unknown): SharedFoodRecord {
  const envelope = payload as ApiEnvelope<{ record?: SharedFoodRecord }>
  if (envelope && typeof envelope === 'object' && 'code' in envelope) {
    if (Number(envelope.code) !== 0) throw new Error(envelope.message || '分享数据读取失败')
    const record = envelope.data?.record
    if (!record) throw new Error('分享数据为空')
    return record
  }
  const direct = payload as { record?: SharedFoodRecord }
  if (!direct?.record) throw new Error('分享数据为空')
  return direct.record
}

async function fetchSharedFoodRecord(recordId: string, apiBaseUrl: string, signal: AbortSignal): Promise<SharedFoodRecord> {
  const response = await fetch(`${apiBaseUrl}/api/food-record/share/${encodeURIComponent(recordId)}`, { signal })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message || '')
      : ''
    if (response.status === 403) throw new Error(message || '这条饮食记录当前不可公开查看。')
    if (response.status === 404) throw new Error(message || '这条饮食记录不存在，或分享链接已经失效。')
    throw new Error(message || '分享页暂时无法打开，请稍后再试。')
  }
  return unwrapRecordResponse(payload)
}

function round1(value: unknown): string {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return '0'
  const rounded = Math.round(numberValue * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function recordItemIntake(item: SharedFoodRecordItem): number {
  const intake = Number(item.intake || 0)
  if (Number.isFinite(intake) && intake > 0) return intake
  const weight = Number(item.weight || 0)
  const ratio = item.ratio == null ? 100 : Number(item.ratio)
  if (!Number.isFinite(weight) || weight <= 0) return 0
  return weight * (Number.isFinite(ratio) ? ratio : 100) / 100
}

function recordImageUrls(record: SharedFoodRecord): string[] {
  return [...(Array.isArray(record.image_paths) ? record.image_paths : []), record.image_path]
    .map((url) => String(url || '').trim())
    .filter(Boolean)
}

function recordItemCalories(item: SharedFoodRecordItem): number {
  const ratio = item.ratio == null ? 100 : Number(item.ratio)
  const safeRatio = Number.isFinite(ratio) ? ratio : 100
  return Number(item.nutrients?.calories || 0) * safeRatio / 100
}

function mealLabel(record: SharedFoodRecord): string {
  return mealLabels[String(record.meal_type || '').trim()] || '饮食'
}

function buildRecordTitle(record: SharedFoodRecord): string {
  const calories = Math.round(Number(record.total_calories || 0))
  const prefix = `${mealLabel(record)}饮食记录`
  return calories > 0 ? `${prefix} · ${calories} kcal` : prefix
}

function buildRecordDescription(record: SharedFoodRecord): string {
  const description = String(record.description || '').trim()
  if (description) return description
  const foods = (record.items || [])
    .map((item) => String(item.name || '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('、')
  const macros = `蛋白质 ${round1(record.total_protein)}g，碳水 ${round1(record.total_carbs)}g，脂肪 ${round1(record.total_fat)}g`
  return foods ? `${foods}。${macros}` : macros
}

function formatRecordTime(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

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

function syncShareMeta(record: SharedFoodRecord, pageUrl: string) {
  const title = `${buildRecordTitle(record)}丨${brand.fullName}`
  const description = buildRecordDescription(record)
  const image = recordImageUrls(record)[0] || absoluteUrl(brand.assets.logoShitan)
  const canonicalUrl = pageUrl.split('?')[0] || pageUrl
  document.title = title
  upsertMeta('meta[name="description"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'description'
    return meta
  }, description)
  upsertMeta('meta[property="og:title"]', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:title')
    return meta
  }, title)
  upsertMeta('meta[property="og:description"]', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:description')
    return meta
  }, description)
  upsertMeta('meta[property="og:url"]', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:url')
    return meta
  }, pageUrl)
  upsertMeta('meta[property="og:image"]', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:image')
    return meta
  }, image)
  upsertMeta('meta[property="og:image:alt"]', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:image:alt')
    return meta
  }, title)
  upsertMeta('meta[name="twitter:card"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'twitter:card'
    return meta
  }, 'summary_large_image')
  upsertMeta('meta[name="twitter:title"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'twitter:title'
    return meta
  }, title)
  upsertMeta('meta[name="twitter:description"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'twitter:description'
    return meta
  }, description)
  upsertMeta('meta[name="twitter:image"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'twitter:image'
    return meta
  }, image)
  upsertMeta('meta[name="twitter:url"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'twitter:url'
    return meta
  }, canonicalUrl)
  upsertMeta('meta[name="robots"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    return meta
  }, 'noindex, nofollow')
  upsertLink('canonical', canonicalUrl)
}

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent)
}

function buildAppSchemeUrl(recordId: string): string {
  return `foodlink://food-record?record_id=${encodeURIComponent(recordId)}`
}

function buildAppOpenUrl(recordId: string): string {
  const schemeUrl = buildAppSchemeUrl(recordId)
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
    return `intent://food-record?record_id=${encodeURIComponent(recordId)}#Intent;scheme=foodlink;package=cn.healthymax.foodlink;end`
  }
  return schemeUrl
}

function tryOpenAppSilently(schemeUrl: string) {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.src = schemeUrl
  iframe.style.display = 'none'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)
  window.setTimeout(() => iframe.remove(), 1600)
}

function ShareSkeleton() {
  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-5 px-4 py-5 md:px-8 md:py-8">
      <div className="h-10 w-28 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
        <div className="flex flex-col gap-4">
          <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="h-20 animate-pulse rounded-md bg-muted" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-svh bg-gradient-page">
      <main className="mx-auto grid min-h-svh max-w-xl place-items-center px-5 py-12">
        <section className="w-full rounded-md border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle size={24} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{message}</p>
          <Link
            to="/"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            回到首页
          </Link>
        </section>
      </main>
    </div>
  )
}

export function FoodRecordSharePage() {
  const { recordId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const apiBaseUrl = useMemo(() => resolveShareApiBaseUrl(searchParams), [searchParams])
  const [state, setState] = useState<LoadState>({ status: 'loading', requestKey: '' })
  const trimmedRecordId = recordId.trim()
  const requestKey = useMemo(() => `${apiBaseUrl}::${trimmedRecordId}`, [apiBaseUrl, trimmedRecordId])
  const missingRecordState: Extract<LoadState, { status: 'error' }> | null = trimmedRecordId
    ? null
    : { status: 'error', requestKey, title: '缺少记录', message: '分享链接缺少饮食记录 ID。' }

  useEffect(() => {
    if (!trimmedRecordId) return
    const controller = new AbortController()
    fetchSharedFoodRecord(trimmedRecordId, apiBaseUrl, controller.signal)
      .then((record) => setState({ status: 'ready', requestKey, record }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          requestKey,
          title: '暂时无法打开',
          message: error instanceof Error ? error.message : '分享页暂时无法打开，请稍后再试。',
        })
      })
    return () => controller.abort()
  }, [apiBaseUrl, requestKey, trimmedRecordId])

  const pageUrl = useMemo(() => {
    if (typeof window === 'undefined') return absoluteUrl(`/share/food-record/${encodeURIComponent(trimmedRecordId)}`)
    return window.location.href
  }, [trimmedRecordId])
  const appSchemeUrl = useMemo(() => buildAppSchemeUrl(trimmedRecordId), [trimmedRecordId])
  const appOpenUrl = useMemo(() => buildAppOpenUrl(trimmedRecordId), [trimmedRecordId])

  useEffect(() => {
    if (state.status === 'ready') syncShareMeta(state.record, pageUrl)
  }, [pageUrl, state])

  useEffect(() => {
    if (state.status !== 'ready' || !trimmedRecordId || !isMobileBrowser()) return
    const key = `foodlink:auto-open:${trimmedRecordId}`
    if (window.sessionStorage.getItem(key) === '1') return
    window.sessionStorage.setItem(key, '1')
    const timer = window.setTimeout(() => tryOpenAppSilently(appSchemeUrl), 500)
    return () => window.clearTimeout(timer)
  }, [appSchemeUrl, state.status, trimmedRecordId])

  const isPendingRequest = Boolean(trimmedRecordId) && state.requestKey !== requestKey

  if (missingRecordState) return <ErrorState title={missingRecordState.title} message={missingRecordState.message} />
  if (state.status === 'loading' || isPendingRequest) return <ShareSkeleton />
  if (state.status === 'error') return <ErrorState title={state.title} message={state.message} />

  const { record } = state
  const title = buildRecordTitle(record)
  const description = buildRecordDescription(record)
  const images = recordImageUrls(record)
  const foods = (record.items || []).filter((item) => String(item.name || '').trim()).slice(0, 8)
  const recordTime = formatRecordTime(record.record_time)
  const meal = mealLabel(record)

  return (
    <div className="min-h-svh overflow-x-clip bg-gradient-page">
      <main className="mx-auto flex max-w-[440px] flex-col gap-3 px-4 pb-[calc(6.25rem+env(safe-area-inset-bottom,0px))] pt-3 md:max-w-3xl md:gap-4 md:px-8 md:pb-12 md:pt-8">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <Link to="/" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <img src={brand.assets.loginLogo} alt="" className="size-7 rounded-md object-contain" />
            {brand.shortName}
          </Link>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{meal}</span>
        </div>

        <section className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm">
          <div className="relative aspect-[4/3] bg-muted md:aspect-[16/9]">
            {images[0] ? (
              <img src={images[0]} alt={title} className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center bg-[linear-gradient(135deg,#e9f8ee,#f9fbf5)]">
                <img src={brand.assets.logoShitan} alt={brand.fullName} className="h-28 w-28 rounded-2xl object-contain" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
            <span className="absolute left-3 top-3 rounded-full bg-white/92 px-3 py-1.5 text-xs font-bold text-foreground shadow-sm">{meal}</span>
            {recordTime ? <span className="absolute bottom-3 left-3 text-sm font-semibold text-white drop-shadow">{recordTime}</span> : null}
          </div>

          <div className="flex flex-col gap-4 px-3 py-4 md:gap-5 md:p-6">
            <div className="space-y-2.5">
              <h1 className="text-[1.75rem] font-black leading-[1.12] text-foreground md:text-4xl">{title}</h1>
              <p className="text-[0.95rem] leading-6 text-muted-foreground md:leading-7">{description}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric icon={<Flame size={15} />} label="热量" value={Math.round(Number(record.total_calories || 0)).toString()} unit="kcal" />
              <Metric icon={<Beef size={15} />} label="蛋白" value={round1(record.total_protein)} unit="g" />
              <Metric icon={<Wheat size={15} />} label="碳水" value={round1(record.total_carbs)} unit="g" />
              <Metric icon={<Droplets size={15} />} label="脂肪" value={round1(record.total_fat)} unit="g" />
            </div>

            {foods.length ? (
              <div className="rounded-md border border-border/80 bg-background px-3 py-3.5 md:p-4">
                <h2 className="text-base font-black text-foreground">食物明细</h2>
                <div className="mt-2 divide-y divide-border">
                  {foods.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-4 py-2.5 md:py-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-foreground">{item.name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">摄入 {Math.round(recordItemIntake(item))}g</p>
                      </div>
                      <span className="shrink-0 text-base font-bold text-muted-foreground">
                        {Math.round(recordItemCalories(item))} kcal
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <p className="px-2 text-center text-xs leading-6 text-muted-foreground">
          饮食分析结果仅供参考，不构成医学诊断。继续记录饮食，请在 {brand.fullName} App 或小程序中查看。
        </p>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(1.05rem+env(safe-area-inset-bottom,0px))] pt-3">
        <a
          href={appOpenUrl}
          className="mx-auto inline-flex min-h-14 w-full max-w-72 items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-black text-primary-foreground shadow-[0_12px_32px_rgba(16,185,129,0.28)] transition-transform active:scale-[0.98]"
        >
          <Smartphone size={19} />
          App 内打开
        </a>
      </div>
      <div className="hidden md:block">
        <SiteFooter />
      </div>
    </div>
  )
}

function Metric({ icon, label, value, unit }: { icon: ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-1.5 rounded-sm bg-card px-2 py-1.5 shadow-[inset_0_0_0_1px_rgb(226_232_240/0.72)]">
      <div className="flex min-w-0 items-center gap-1 text-primary">
        {icon}
        <span className="truncate text-[0.68rem] font-bold text-muted-foreground">{label}</span>
      </div>
      <div className="flex shrink-0 items-baseline gap-0.5 whitespace-nowrap">
        <span className="text-[1.3rem] font-black leading-none text-foreground">{value}</span>
        <span className="text-[0.68rem] font-bold text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
