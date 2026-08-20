import { useEffect, useState } from 'react'
import { Copy, ExternalLink, ImageOff, Images, Loader2, RefreshCw, Search, X } from 'lucide-react'
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
  source_type: 'analysis_task' | 'food_record'
  task_type: string
  status: string
  record_id: string
  image_url: string
  thumbnail_url: string
  description: string
  user_id: string
  user_nickname: string
  user_avatar: string
  user_phone: string
  created_at: string
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
}

const statusClasses: Record<string, string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400',
  recorded: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400',
  timed_out: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400',
  processing: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
}

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function UserFoodPhotosPage({ onLogout, onMenuChange }: PageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [source, setSource] = useState(searchParams.get('source') ?? 'all')
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [page, setPage] = useState(positiveInt(searchParams.get('page'), 1))
  const [limit, setLimit] = useState(positiveInt(searchParams.get('limit'), 40))
  const [items, setItems] = useState<UserFoodPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const [preview, setPreview] = useState<UserFoodPhoto | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadPhotos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, source, status, searchNonce])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (source !== 'all') params.set('source', source)
    if (status !== 'all') params.set('status', status)
    if (page !== 1) params.set('page', String(page))
    if (limit !== 40) params.set('limit', String(limit))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, status, page, limit])

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
                集中查看用户在食物识别和饮食记录中上传的图片。相同用户的同一图片会自动去重。
              </CardDescription>
            </div>
            <Badge variant='outline' className='max-w-xs shrink-0 whitespace-normal break-all px-3 py-1.5 text-xs font-normal'>
              API: {displayApiBase()}
            </Badge>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className='grid gap-4 pt-6 lg:grid-cols-[minmax(260px,2fr)_170px_170px_120px_auto] lg:items-end'>
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
          </CardContent>
        </Card>

        <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground'>
          <span>共 {total} 张，当前展示 {items.length} 张</span>
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
            {items.map((item) => <PhotoCard key={`${item.user_id}-${item.image_url}`} item={item} onPreview={() => setPreview(item)} />)}
          </div>
        )}
      </main>

      {preview ? <PhotoPreview item={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  )
}

function PhotoCard({ item, onPreview }: { item: UserFoodPhoto; onPreview: () => void }) {
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
        <div className='flex items-center justify-between gap-2 border-t pt-3'>
          <Badge variant='secondary'>{item.source_type === 'analysis_task' ? '识别上传' : '饮食记录'}</Badge>
          <Button variant='ghost' size='sm' onClick={onPreview}>查看大图</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PhotoPreview({ item, onClose }: { item: UserFoodPhoto; onClose: () => void }) {
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
            <PreviewRow label='来源' value={item.source_type === 'analysis_task' ? '食物识别上传' : '饮食记录补图'} />
            <PreviewRow label='状态' value={statusLabels[item.status] || item.status} />
            {item.task_type ? <PreviewRow label='任务类型' value={item.task_type} /> : null}
            <PreviewRow label='来源 ID' value={item.source_id} />
            {item.record_id ? <PreviewRow label='记录 ID' value={item.record_id} /> : null}
            {item.description ? <PreviewRow label='识别摘要' value={item.description} /> : null}
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

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function formatTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
