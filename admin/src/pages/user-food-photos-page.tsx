import { useEffect, useState } from 'react'
import { Ban, CheckCircle2, Copy, ExternalLink, ImageOff, Images, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { adminRequest, copyText, displayApiBase } from '@/lib/api'

type PageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type UserFoodPhoto = {
  source_id: string
  source_type: 'analysis_task' | 'food_record' | 'public_food' | 'packaged_correction' | 'user_recipe'
  task_type: string
  status: string
  record_id: string
  image_key: string
  image_url: string
  thumbnail_url: string
  description: string
  user_id: string
  user_nickname: string
  user_avatar: string
  user_phone: string
  circle_visibility: 'visible' | 'not_shared' | 'not_applicable'
  annotation_status: AnnotationStatus
  annotation_labels: AnnotationLabel[]
  exclusion_reason: ExclusionReason | ''
  annotation_updated_at?: string
  nutrition?: PhotoNutrition
  created_at: string
}

type AnnotationStatus = 'pending' | 'kept' | 'excluded'
type AnnotationLabel = 'snack' | 'fruit' | 'takeout' | 'home_cooked' | 'restaurant' | 'beverage' | 'dessert' | 'packaged_food'
type ExclusionReason = 'non_food' | 'multi_dish_scene' | 'unusable' | 'duplicate' | 'label_or_package_only' | 'other'

type AnnotationResponse = {
  annotation: {
    review_status: AnnotationStatus
    labels: AnnotationLabel[]
    exclusion_reason: ExclusionReason | ''
    updated_at: string
  }
}

type PhotoNutrition = {
  source: 'food_record' | 'analysis_result' | 'public_food'
  item_count: number
  item_names?: string[]
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  saturated_fat: number
  cholesterol_mg: number
  sodium_mg: number
  potassium_mg: number
  calcium_mg: number
  iron_mg: number
  magnesium_mg: number
  zinc_mg: number
  vitamin_a_rae_mcg: number
  vitamin_c_mg: number
  vitamin_d_mcg: number
  vitamin_e_mg: number
  vitamin_k_mcg: number
  thiamin_mg: number
  riboflavin_mg: number
  niacin_mg: number
  vitamin_b6_mg: number
  folate_mcg: number
  vitamin_b12_mcg: number
}

type ListResponse = {
  items: UserFoodPhoto[]
  page: number
  limit: number
  total: number
}

const statusLabels: Record<string, string> = {
  pending: '等待分析',
  processing: '分析中',
  done: '分析完成',
  failed: '分析失败',
  cancelled: '已取消',
  timed_out: '已超时',
  recorded: '已保存记录',
  published: '已发布',
  saved: '已保存',
}

const statusClasses: Record<string, string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400',
  recorded: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400',
  published: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400',
  saved: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400',
  timed_out: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400',
  processing: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
}

const annotationStatusLabels: Record<AnnotationStatus, string> = {
  pending: '待清洗',
  kept: '已保留',
  excluded: '已排除',
}

const annotationStatusClasses: Record<AnnotationStatus, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  kept: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  excluded: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
}

const annotationLabelOptions: Array<[AnnotationLabel, string]> = [
  ['snack', '零食'],
  ['fruit', '水果'],
  ['takeout', '外卖'],
  ['home_cooked', '家常菜'],
  ['restaurant', '堂食'],
  ['beverage', '饮品'],
  ['dessert', '甜品烘焙'],
  ['packaged_food', '包装食品'],
]

const exclusionReasonOptions: Array<[ExclusionReason, string]> = [
  ['non_food', '非食物 / 道具 / 截图'],
  ['multi_dish_scene', '一桌多菜 / 场景过杂'],
  ['unusable', '模糊遮挡 / 主体不可用'],
  ['duplicate', '重复或近似重复'],
  ['label_or_package_only', '仅包装或营养标签'],
  ['other', '其他无效内容'],
]

const exclusionReasonNames = Object.fromEntries(exclusionReasonOptions) as Record<ExclusionReason, string>

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function UserFoodPhotosPage({ onLogout, onMenuChange }: PageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [source, setSource] = useState(searchParams.get('source') ?? 'all')
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [circleVisibility, setCircleVisibility] = useState(searchParams.get('circle_visibility') ?? 'all')
  const [annotationStatus, setAnnotationStatus] = useState(searchParams.get('annotation_status') ?? 'all')
  const [annotationLabel, setAnnotationLabel] = useState(searchParams.get('annotation_label') ?? 'all')
  const [sortBy, setSortBy] = useState(searchParams.get('sort_by') ?? 'created_at')
  const [sortOrder, setSortOrder] = useState(searchParams.get('sort_order') ?? 'desc')
  const [page, setPage] = useState(positiveInt(searchParams.get('page'), 1))
  const [limit, setLimit] = useState(positiveInt(searchParams.get('limit'), 40))
  const [items, setItems] = useState<UserFoodPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const [preview, setPreview] = useState<UserFoodPhoto | null>(null)
  const [savingAnnotationKey, setSavingAnnotationKey] = useState('')
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadPhotos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, source, status, circleVisibility, annotationStatus, annotationLabel, sortBy, sortOrder, searchNonce])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (source !== 'all') params.set('source', source)
    if (status !== 'all') params.set('status', status)
    if (circleVisibility !== 'all') params.set('circle_visibility', circleVisibility)
    if (annotationStatus !== 'all') params.set('annotation_status', annotationStatus)
    if (annotationLabel !== 'all') params.set('annotation_label', annotationLabel)
    if (sortBy !== 'created_at') params.set('sort_by', sortBy)
    if (sortOrder !== 'desc') params.set('sort_order', sortOrder)
    if (page !== 1) params.set('page', String(page))
    if (limit !== 40) params.set('limit', String(limit))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, status, circleVisibility, annotationStatus, annotationLabel, sortBy, sortOrder, page, limit])

  useEffect(() => {
    if (!preview) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [preview])

  async function loadPhotos(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        source,
        status,
        circle_visibility: circleVisibility,
        annotation_status: annotationStatus,
        annotation_label: annotationLabel,
        sort_by: sortBy,
        sort_order: sortOrder,
        page: String(nextPage),
        limit: String(limit),
      })
      const data = await adminRequest<ListResponse>(`/api/admin/user-food-photos?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
    } catch (error) {
      setItems([])
      setTotal(0)
      toast.error(error instanceof Error ? error.message : '照片读取失败')
    } finally {
      setLoading(false)
    }
  }

  function runSearch() {
    setPage(1)
    setSearchNonce((value) => value + 1)
  }

  async function saveAnnotation(item: UserFoodPhoto, reviewStatus: AnnotationStatus, labels: AnnotationLabel[], exclusionReason = '') {
    const annotationKey = `${item.user_id}-${item.image_key}`
    setSavingAnnotationKey(annotationKey)
    try {
      const data = await adminRequest<AnnotationResponse>('/api/admin/user-food-photos/annotation', {
        method: 'PUT',
        body: JSON.stringify({
          user_id: item.user_id,
          image_key: item.image_key,
          review_status: reviewStatus,
          labels,
          exclusion_reason: exclusionReason,
        }),
      })
      const nextItem: UserFoodPhoto = {
        ...item,
        annotation_status: data.annotation.review_status,
        annotation_labels: data.annotation.labels || [],
        exclusion_reason: data.annotation.exclusion_reason || '',
        annotation_updated_at: data.annotation.updated_at,
      }
      setItems((current) => current.map((photo) => photo.user_id === item.user_id && photo.image_key === item.image_key ? nextItem : photo))
      setPreview((current) => current?.user_id === item.user_id && current.image_key === item.image_key ? nextItem : current)
      toast.success(reviewStatus === 'excluded' ? '已从标注数据集中排除' : reviewStatus === 'kept' ? '已保留并保存标签' : '已恢复为待清洗')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存标注失败')
    } finally {
      setSavingAnnotationKey('')
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1680px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='user-food-photos' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-4 pb-8'>
        <Card className='border bg-card/90 shadow-lg backdrop-blur-md'>
          <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
            <div className='space-y-2'>
              <p className='text-sm font-medium text-primary'>用户内容 / 图片资产</p>
              <CardTitle className='flex items-center gap-3 text-3xl tracking-tight'>
                <Images className='size-8' />
                食物照片
              </CardTitle>
              <CardDescription className='max-w-2xl text-base leading-relaxed'>
                先清洗无效图片，再进行零食、水果、外卖等多标签标注。排除操作只影响标注数据集，不删除用户原图或饮食记录。
              </CardDescription>
            </div>
            <Badge variant='outline' className='max-w-xs shrink-0 whitespace-normal break-all px-3 py-1.5 text-xs font-normal'>
              API: {displayApiBase()}
            </Badge>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className='space-y-5 pt-6'>
            <div className='grid gap-4 xl:grid-cols-[minmax(240px,2fr)_150px_170px_180px_110px_auto] xl:items-end'>
              <div className='space-y-2'>
                <Label htmlFor='photo-search'>搜索用户或内容</Label>
                <div className='relative'>
                  <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    id='photo-search'
                    className='pl-9'
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && runSearch()}
                    placeholder='昵称 / 手机号 / userId / 任务ID / 描述'
                  />
                </div>
              </div>
              <FilterSelect label='来源' value={source} onValueChange={(value) => { setSource(value); setPage(1) }} options={[
                ['all', '全部来源'],
                ['analysis_task', '识别上传'],
                ['food_record', '饮食记录'],
                ['public_food', '公共食物'],
                ['packaged_correction', '包装食品纠错'],
                ['user_recipe', '用户食谱'],
              ]} />
              <FilterSelect label='状态' value={status} onValueChange={(value) => { setStatus(value); setPage(1) }} options={[
                ['all', '全部状态'],
                ['done', '分析完成'],
                ['processing', '分析中'],
                ['pending', '等待分析'],
                ['failed', '分析失败'],
                ['timed_out', '已超时'],
                ['cancelled', '已取消'],
                ['recorded', '已保存记录'],
                ['published', '已发布'],
                ['saved', '已保存'],
              ]} />
              <FilterSelect label='圈子可见性' value={circleVisibility} onValueChange={(value) => { setCircleVisibility(value); setPage(1) }} options={[
                ['all', '全部可见性'],
                ['visible', '已公开到圈子'],
                ['not_shared', '未公开到圈子'],
                ['not_applicable', '非圈子内容'],
              ]} />
              <FilterSelect label='每页' value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setPage(1) }} options={[
                ['20', '20 张'],
                ['40', '40 张'],
                ['80', '80 张'],
                ['100', '100 张'],
              ]} />
              <Button onClick={runSearch} disabled={loading} aria-label={loading ? '正在刷新' : '刷新照片'}>
                {loading ? <Loader2 className='size-4 animate-spin' /> : <RefreshCw className='size-4' />}
                {!loading ? '刷新' : null}
              </Button>
            </div>
            <div className='grid gap-4 border-t pt-5 md:grid-cols-[180px_190px_minmax(260px,380px)_190px] md:items-end'>
              <FilterSelect label='清洗状态' value={annotationStatus} onValueChange={(value) => { setAnnotationStatus(value); setPage(1) }} options={[
                ['all', '全部清洗状态'],
                ['pending', '待清洗'],
                ['kept', '已保留'],
                ['excluded', '已排除'],
              ]} />
              <FilterSelect label='食物标签' value={annotationLabel} onValueChange={(value) => { setAnnotationLabel(value); setPage(1) }} options={[
                ['all', '全部标签'],
                ...annotationLabelOptions,
              ]} />
              <FilterSelect label='排列方式' value={sortBy} onValueChange={(value) => { setSortBy(value); setPage(1) }} options={photoSortOptions} />
              <FilterSelect label='排序方向' value={sortOrder} onValueChange={(value) => { setSortOrder(value); setPage(1) }} options={sortBy === 'created_at'
                ? [['desc', '最新优先'], ['asc', '最早优先']]
                : [['desc', '从高到低'], ['asc', '从低到高']]} />
            </div>
          </CardContent>
        </Card>

        <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground'>
          <span>共 {total} 张，当前展示 {items.length} 张 · {photoSortLabels[sortBy] || '上传时间'}（{sortBy === 'created_at' ? (sortOrder === 'asc' ? '最早优先' : '最新优先') : (sortOrder === 'asc' ? '从低到高' : '从高到低')}）</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
            <span className='px-1 tabular-nums'>第 {page} / {totalPages} 页</span>
            <Button variant='outline' size='sm' disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className='aspect-[4/5] rounded-xl' />)}
          </div>
        ) : items.length === 0 ? (
          <div className='flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 p-8 text-center'>
            <ImageOff className='mb-4 size-12 text-muted-foreground' />
            <h2 className='text-lg font-semibold'>没有找到食物照片</h2>
            <p className='mt-2 text-sm text-muted-foreground'>可以更换用户、来源或状态筛选条件。</p>
          </div>
        ) : (
          <div className='grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
            {items.map((item) => <PhotoCard
              key={`${item.user_id}-${item.image_url}`}
              item={item}
              saving={savingAnnotationKey === `${item.user_id}-${item.image_key}`}
              onAnnotate={(reviewStatus, labels, reason) => void saveAnnotation(item, reviewStatus, labels, reason)}
              onPreview={() => setPreview(item)}
            />)}
          </div>
        )}
      </main>

      {preview ? <PhotoPreview
        item={preview}
        saving={savingAnnotationKey === `${preview.user_id}-${preview.image_key}`}
        onAnnotate={(reviewStatus, labels, reason) => void saveAnnotation(preview, reviewStatus, labels, reason)}
        onClose={() => setPreview(null)}
      /> : null}
    </div>
  )
}

function PhotoCard({ item, saving, onAnnotate, onPreview }: {
  item: UserFoodPhoto
  saving: boolean
  onAnnotate: (status: AnnotationStatus, labels: AnnotationLabel[], reason?: string) => void
  onPreview: () => void
}) {
  const userName = item.user_nickname || item.user_phone || `用户 ${shortId(item.user_id)}`
  return (
    <Card className='group overflow-hidden transition-all hover:border-primary/30 hover:shadow-lg'>
      <button type='button' className='relative block aspect-square w-full overflow-hidden bg-muted' onClick={onPreview}>
        <img
          src={item.thumbnail_url || item.image_url}
          alt={`${userName}上传的食物照片`}
          className='size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
          loading='lazy'
        />
        <span className={`absolute top-3 left-3 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${circleVisibilityClasses[item.circle_visibility]}`}>
          {circleVisibilityLabels[item.circle_visibility]}
        </span>
        <span className={`absolute top-3 right-3 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${item.nutrition ? 'border-blue-300 bg-blue-50/95 text-blue-700' : 'border-slate-300 bg-slate-50/95 text-slate-500'}`}>
          {item.nutrition ? '营养已分析' : '暂无营养'}
        </span>
        <span className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-10 pb-3 text-left text-xs text-white'>
          {formatTime(item.created_at)}
        </span>
      </button>
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            {item.user_avatar ? <img src={item.user_avatar} alt='' className='size-8 shrink-0 rounded-full object-cover' /> : <div className='flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary'>{userName.slice(0, 1)}</div>}
            <div className='min-w-0'>
              <p className='truncate text-sm font-semibold'>{userName}</p>
              <p className='truncate text-xs text-muted-foreground'>{shortId(item.user_id)}</p>
            </div>
          </div>
          <Badge variant='outline' className={statusClasses[item.status]}>{statusLabels[item.status] || item.status}</Badge>
        </div>
        {item.description ? <p className='line-clamp-2 text-sm leading-relaxed text-muted-foreground'>{item.description}</p> : null}
        {item.nutrition ? <NutritionSummary nutrition={item.nutrition} /> : <p className='rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>该图片尚无可用营养分析结果</p>}
        <AnnotationControls item={item} saving={saving} onAnnotate={onAnnotate} compact />
        <div className='flex items-center justify-between gap-2 border-t pt-3'>
          <Badge variant='secondary'>{sourceLabels[item.source_type] || item.source_type}</Badge>
          <Button variant='ghost' size='sm' onClick={onPreview}>查看大图</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AnnotationControls({ item, saving, onAnnotate, compact = false }: {
  item: UserFoodPhoto
  saving: boolean
  onAnnotate: (status: AnnotationStatus, labels: AnnotationLabel[], reason?: string) => void
  compact?: boolean
}) {
  const labels = item.annotation_labels || []
  function toggleLabel(label: AnnotationLabel) {
    const nextLabels = labels.includes(label) ? labels.filter((itemLabel) => itemLabel !== label) : [...labels, label]
    onAnnotate('kept', nextLabels)
  }
  return (
    <div className='space-y-2.5 rounded-lg border bg-muted/20 p-3'>
      <div className='flex items-center justify-between gap-2'>
        <Badge variant='outline' className={annotationStatusClasses[item.annotation_status]}>
          {saving ? <Loader2 className='mr-1 size-3 animate-spin' /> : null}
          {annotationStatusLabels[item.annotation_status]}
        </Badge>
        {item.annotation_status === 'excluded' && item.exclusion_reason ? (
          <span className='truncate text-[11px] text-muted-foreground'>{exclusionReasonNames[item.exclusion_reason]}</span>
        ) : null}
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {annotationLabelOptions.map(([value, label]) => (
          <Button
            key={value}
            type='button'
            variant={labels.includes(value) && item.annotation_status === 'kept' ? 'default' : 'outline'}
            size='sm'
            className={compact ? 'h-7 px-2 text-[11px]' : 'h-8 text-xs'}
            disabled={saving}
            aria-pressed={labels.includes(value)}
            onClick={() => toggleLabel(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className='grid grid-cols-2 gap-2'>
        <Button type='button' size='sm' variant='outline' disabled={saving} onClick={() => onAnnotate('kept', labels)}>
          <CheckCircle2 className='size-3.5' />保留
        </Button>
        <Select disabled={saving} onValueChange={(reason) => onAnnotate('excluded', [], reason)}>
          <SelectTrigger className='h-9 text-xs text-destructive'><Ban className='size-3.5' /><SelectValue placeholder='排除原因' /></SelectTrigger>
          <SelectContent>{exclusionReasonOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  )
}

function PhotoPreview({ item, saving, onAnnotate, onClose }: {
  item: UserFoodPhoto
  saving: boolean
  onAnnotate: (status: AnnotationStatus, labels: AnnotationLabel[], reason?: string) => void
  onClose: () => void
}) {
  async function handleCopy() {
    try {
      await copyText(item.image_url)
      toast.success('图片地址已复制')
    } catch {
      toast.error('复制失败')
    }
  }
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm' role='dialog' aria-modal='true' aria-label='食物照片预览' onClick={onClose}>
      <div className='grid max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-2xl border bg-card shadow-2xl lg:grid-cols-[minmax(0,1fr)_340px]' onClick={(event) => event.stopPropagation()}>
        <div className='flex min-h-[50vh] items-center justify-center bg-black'>
          <img src={item.image_url} alt='用户上传的食物照片大图' className='max-h-[94vh] max-w-full object-contain' />
        </div>
        <div className='flex max-h-[94vh] flex-col p-5'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-lg font-semibold'>{item.user_nickname || item.user_phone || '未设置昵称'}</p>
              <p className='mt-1 break-all text-xs text-muted-foreground'>{item.user_id}</p>
            </div>
            <Button variant='ghost' size='icon' onClick={onClose} aria-label='关闭预览'><X className='size-5' /></Button>
          </div>
          <div className='mt-5 space-y-4 overflow-y-auto text-sm'>
            <PreviewRow label='上传时间' value={formatTime(item.created_at)} />
            <PreviewRow label='来源' value={sourceLabels[item.source_type] || item.source_type} />
            <PreviewRow label='状态' value={statusLabels[item.status] || item.status} />
            <PreviewRow label='圈子可见性' value={circleVisibilityLabels[item.circle_visibility]} />
            {item.task_type ? <PreviewRow label='任务类型' value={item.task_type} /> : null}
            <PreviewRow label='来源 ID' value={item.source_id} />
            {item.record_id ? <PreviewRow label='记录 ID' value={item.record_id} /> : null}
            {item.description ? <PreviewRow label='识别摘要' value={item.description} /> : null}
            <div className='space-y-2 border-t pt-4'>
              <p className='text-sm font-semibold'>数据清洗与分类</p>
              <p className='text-xs leading-relaxed text-muted-foreground'>“一桌多菜”仅指无法明确对应单份餐食的复杂场景；同一份餐盘里有多个食物仍可保留并打标签。</p>
              <AnnotationControls item={item} saving={saving} onAnnotate={onAnnotate} />
            </div>
            <NutritionDetails nutrition={item.nutrition} />
          </div>
          <div className='mt-auto grid gap-2 pt-5'>
            <Button variant='outline' onClick={() => void handleCopy()}><Copy className='size-4' />复制图片地址</Button>
            <Button asChild><a href={item.image_url} target='_blank' rel='noreferrer'><ExternalLink className='size-4' />在新窗口打开</a></Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onValueChange, options }: { label: string; value: string; onValueChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className='space-y-2'>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div><p className='text-xs font-medium text-muted-foreground'>{label}</p><p className='mt-1 break-words leading-relaxed'>{value}</p></div>
}

function NutritionSummary({ nutrition }: { nutrition: PhotoNutrition }) {
  return (
    <div className='grid grid-cols-4 gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-center'>
      <NutritionMetric label='热量' value={nutrition.calories} unit='kcal' compact />
      <NutritionMetric label='蛋白质' value={nutrition.protein} unit='g' compact />
      <NutritionMetric label='碳水' value={nutrition.carbs} unit='g' compact />
      <NutritionMetric label='脂肪' value={nutrition.fat} unit='g' compact />
    </div>
  )
}

function NutritionDetails({ nutrition }: { nutrition?: PhotoNutrition }) {
  if (!nutrition) {
    return (
      <div className='border-t pt-4'>
        <p className='text-sm font-semibold'>营养元素</p>
        <p className='mt-2 text-sm text-muted-foreground'>该图片尚无可用营养分析结果。</p>
      </div>
    )
  }
  const micronutrients = nutrientDetailMeta.filter(({ key }) => nutrition[key] > 0)
  return (
    <div className='space-y-3 border-t pt-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-semibold'>营养元素</p>
        <Badge variant='secondary'>{nutritionSourceLabels[nutrition.source]}</Badge>
      </div>
      {nutrition.item_names?.length ? <p className='text-xs leading-relaxed text-muted-foreground'>识别食物：{nutrition.item_names.join('、')}</p> : null}
      <div className='grid grid-cols-2 gap-2'>
        <NutritionMetric label='热量' value={nutrition.calories} unit='kcal' />
        <NutritionMetric label='蛋白质' value={nutrition.protein} unit='g' />
        <NutritionMetric label='碳水化合物' value={nutrition.carbs} unit='g' />
        <NutritionMetric label='脂肪' value={nutrition.fat} unit='g' />
      </div>
      {micronutrients.length ? (
        <div className='grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/25 p-3'>
          {micronutrients.map(({ key, label, unit }) => (
            <div key={key} className='flex items-baseline justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{label}</span>
              <span className='font-medium tabular-nums'>{formatNutrientValue(nutrition[key])} {unit}</span>
            </div>
          ))}
        </div>
      ) : <p className='text-xs text-muted-foreground'>暂无微量营养元素数据。</p>}
    </div>
  )
}

function NutritionMetric({ label, value, unit, compact = false }: { label: string; value: number; unit: string; compact?: boolean }) {
  return (
    <div className={compact ? 'min-w-0' : 'rounded-lg bg-background/80 p-2.5'}>
      <p className='truncate text-[11px] text-muted-foreground'>{label}</p>
      <p className={`${compact ? 'text-xs' : 'text-sm'} mt-0.5 font-semibold tabular-nums`}>{formatNutrientValue(value)}<span className='ml-0.5 text-[10px] font-normal text-muted-foreground'>{unit}</span></p>
    </div>
  )
}

function formatNutrientValue(value: number) {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function formatTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

const sourceLabels: Record<UserFoodPhoto['source_type'], string> = {
  analysis_task: '识别上传',
  food_record: '饮食记录',
  public_food: '公共食物',
  packaged_correction: '包装食品纠错',
  user_recipe: '用户食谱',
}

const circleVisibilityLabels: Record<UserFoodPhoto['circle_visibility'], string> = {
  visible: '已公开到圈子',
  not_shared: '未公开到圈子',
  not_applicable: '非圈子内容',
}

const circleVisibilityClasses: Record<UserFoodPhoto['circle_visibility'], string> = {
  visible: 'border-emerald-300 bg-emerald-50/95 text-emerald-700',
  not_shared: 'border-amber-300 bg-amber-50/95 text-amber-800',
  not_applicable: 'border-slate-300 bg-slate-50/95 text-slate-600',
}

const photoSortOptions: Array<[string, string]> = [
  ['created_at', '上传时间'],
  ['calories', '热量'],
  ['protein', '蛋白质'],
  ['carbs', '碳水化合物'],
  ['fat', '脂肪'],
  ['fiber', '膳食纤维'],
  ['sugar', '糖'],
  ['saturated_fat', '饱和脂肪'],
  ['cholesterol_mg', '胆固醇'],
  ['sodium_mg', '钠'],
  ['potassium_mg', '钾'],
  ['calcium_mg', '钙'],
  ['iron_mg', '铁'],
  ['magnesium_mg', '镁'],
  ['zinc_mg', '锌'],
  ['vitamin_a_rae_mcg', '维生素 A'],
  ['vitamin_c_mg', '维生素 C'],
  ['vitamin_d_mcg', '维生素 D'],
  ['vitamin_e_mg', '维生素 E'],
  ['vitamin_k_mcg', '维生素 K'],
  ['thiamin_mg', '维生素 B1'],
  ['riboflavin_mg', '维生素 B2'],
  ['niacin_mg', '烟酸'],
  ['vitamin_b6_mg', '维生素 B6'],
  ['folate_mcg', '叶酸'],
  ['vitamin_b12_mcg', '维生素 B12'],
]

const photoSortLabels = Object.fromEntries(photoSortOptions) as Record<string, string>

type NutrientDetailKey = Exclude<keyof PhotoNutrition, 'source' | 'item_count' | 'item_names' | 'calories' | 'protein' | 'carbs' | 'fat'>

const nutrientDetailMeta: Array<{ key: NutrientDetailKey; label: string; unit: string }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturated_fat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterol_mg', label: '胆固醇', unit: 'mg' },
  { key: 'sodium_mg', label: '钠', unit: 'mg' },
  { key: 'potassium_mg', label: '钾', unit: 'mg' },
  { key: 'calcium_mg', label: '钙', unit: 'mg' },
  { key: 'iron_mg', label: '铁', unit: 'mg' },
  { key: 'magnesium_mg', label: '镁', unit: 'mg' },
  { key: 'zinc_mg', label: '锌', unit: 'mg' },
  { key: 'vitamin_a_rae_mcg', label: '维生素 A', unit: 'μg' },
  { key: 'vitamin_c_mg', label: '维生素 C', unit: 'mg' },
  { key: 'vitamin_d_mcg', label: '维生素 D', unit: 'μg' },
  { key: 'vitamin_e_mg', label: '维生素 E', unit: 'mg' },
  { key: 'vitamin_k_mcg', label: '维生素 K', unit: 'μg' },
  { key: 'thiamin_mg', label: '维生素 B1', unit: 'mg' },
  { key: 'riboflavin_mg', label: '维生素 B2', unit: 'mg' },
  { key: 'niacin_mg', label: '烟酸', unit: 'mg' },
  { key: 'vitamin_b6_mg', label: '维生素 B6', unit: 'mg' },
  { key: 'folate_mcg', label: '叶酸', unit: 'μg' },
  { key: 'vitamin_b12_mcg', label: '维生素 B12', unit: 'μg' },
]

const nutritionSourceLabels: Record<PhotoNutrition['source'], string> = {
  food_record: '用户最终记录',
  analysis_result: '图片分析结果',
  public_food: '公共食物数据',
}
