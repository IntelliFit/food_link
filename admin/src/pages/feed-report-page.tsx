import { useEffect, useMemo, useState } from 'react'
import { Flag, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar } from '@/components/admin-sidebar'
import type { AdminMenuId } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { adminRequest, displayApiBase } from '@/lib/api'
import { cn } from '@/lib/utils'

type FeedReportPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type FeedReportStatus = 'pending' | 'processing' | 'resolved' | 'rejected'
type FeedReportTargetType = 'food_record' | 'exercise_log' | 'circle_post'

type FeedReportItem = {
  id: string
  reporter_user_id: string
  reporter_nickname: string
  reporter_avatar: string
  reported_user_id: string
  reported_nickname: string
  reported_avatar: string
  target_type: FeedReportTargetType
  target_id: string
  reason: string
  reason_name: string
  extra_content: string
  status: FeedReportStatus
  resolution_note: string
  handled_by?: string
  handled_at?: string
  created_at: string
  updated_at: string
}

type FeedReportTargetSnapshot = {
  title: string
  body: string
  description: string
  image_urls: string[]
  author_id: string
  created_at?: string
}

type FeedReportListResponse = {
  items: FeedReportItem[]
  total: number
}

const statusLabels: Record<FeedReportStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已处理',
  rejected: '已驳回',
}

const reasonLabels: Record<string, string> = {
  spam: '垃圾广告',
  porn: '色情低俗',
  illegal: '违法违规',
  abuse: '人身攻击',
  other: '其他',
}

const targetTypeLabels: Record<string, string> = {
  food_record: '饮食记录',
  exercise_log: '运动记录',
  circle_post: '圈子动态',
}

const statusBadgeClass: Record<FeedReportStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-border bg-muted text-muted-foreground',
}

const transitionOptions: Record<FeedReportStatus, FeedReportStatus[]> = {
  pending: ['processing', 'resolved', 'rejected'],
  processing: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
}

export function FeedReportPage({ onLogout, onMenuChange }: FeedReportPageProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [targetType, setTargetType] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [items, setItems] = useState<FeedReportItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [targetSnapshot, setTargetSnapshot] = useState<FeedReportTargetSnapshot | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [updating, setUpdating] = useState(false)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0],
    [items, selectedId],
  )
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, status, targetType])

  useEffect(() => {
    if (selected?.id) {
      setResolutionNote(selected.resolution_note || '')
      void loadDetail(selected.id)
    } else {
      setTargetSnapshot(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        status,
        target_type: targetType,
      })
      const data = await adminRequest<FeedReportListResponse>(`/api/admin/feed-reports?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(nextPage)
      setSelectedId((current) => current || data.items?.[0]?.id || '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true)
    try {
      const data = await adminRequest<{ item: FeedReportItem; target: FeedReportTargetSnapshot }>(
        `/api/admin/feed-reports/${encodeURIComponent(id)}`,
      )
      setTargetSnapshot(data.target)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载详情失败')
      setTargetSnapshot(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function updateStatus(nextStatus: FeedReportStatus) {
    if (!selected) return
    setUpdating(true)
    try {
      const data = await adminRequest<{ item: FeedReportItem }>(
        `/api/admin/feed-reports/${encodeURIComponent(selected.id)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus, resolution_note: resolutionNote }),
        },
      )
      setItems((current) => current.map((item) => (item.id === selected.id ? data.item : item)))
      toast.success('状态已更新')
      if (nextStatus === 'resolved' || nextStatus === 'rejected') {
        toast.info('已发送受理结果系统消息给举报者和被举报者')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '状态更新失败')
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确定删除这条举报记录？删除后不可恢复。')) return
    try {
      await adminRequest(`/api/admin/feed-reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success('已删除')
      setItems((current) => current.filter((item) => item.id !== id))
      if (selectedId === id) {
        setSelectedId('')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[276px_minmax(0,1fr)] gap-5 px-4 py-4'>
      <AdminSidebar activeMenu='feed-reports' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-4 pb-8'>
        <Card className='border bg-card/90 shadow-lg backdrop-blur-md'>
          <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
            <div className='space-y-2'>
              <p className='text-sm font-medium text-primary'>社区治理</p>
              <CardTitle className='text-3xl tracking-tight'>举报管理</CardTitle>
              <CardDescription className='max-w-2xl text-base leading-relaxed'>
                查看、受理用户举报，更新状态后系统会自动向举报者和被举报者发送受理结果私信。
              </CardDescription>
            </div>
            <Badge variant='outline' className='max-w-xs shrink-0 whitespace-normal break-all px-3 py-1.5 text-xs font-normal'>
              API: {displayApiBase()}
            </Badge>
          </CardHeader>
        </Card>

        <div className='grid gap-4 md:grid-cols-4'>
          <StatCard label='当前筛选' value={String(total)} foot='条举报' loading={loading} />
          <StatCard label='待处理' value={String(items.filter((i) => i.status === 'pending').length)} foot='条' loading={loading} />
          <StatCard label='处理中' value={String(items.filter((i) => i.status === 'processing').length)} foot='条' loading={loading} />
          <StatCard
            label='最近提交'
            value={items[0] ? new Date(items[0].created_at).toLocaleString('zh-CN') : '-'}
            foot='按提交时间倒序'
            loading={loading && items.length === 0}
          />
        </div>

        <Card>
          <CardContent className='grid gap-4 pt-6 md:grid-cols-[minmax(280px,2fr)_160px_150px_110px_auto] md:items-end'>
            <div className='space-y-2 md:col-span-1'>
              <Label htmlFor='search'>搜索</Label>
              <div className='relative'>
                <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  id='search'
                  className='pl-9'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') runSearch()
                  }}
                  placeholder='举报 ID / 原因 / 用户昵称 / 补充说明'
                />
              </div>
            </div>
            <FilterSelect label='目标类型' value={targetType} onValueChange={(value) => { setTargetType(value); setPage(1) }} options={[
              { value: 'all', label: '全部类型' },
              { value: 'circle_post', label: '圈子动态' },
              { value: 'food_record', label: '饮食记录' },
              { value: 'exercise_log', label: '运动记录' },
            ]}
            />
            <FilterSelect label='状态' value={status} onValueChange={(value) => { setStatus(value); setPage(1) }} options={[
              { value: 'all', label: '全部状态' },
              { value: 'pending', label: '待处理' },
              { value: 'processing', label: '处理中' },
              { value: 'resolved', label: '已处理' },
              { value: 'rejected', label: '已驳回' },
            ]}
            />
            <FilterSelect label='每页' value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setPage(1) }} options={[
              { value: '20', label: '20' },
              { value: '30', label: '30' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
            />
            <Button className='md:self-end' onClick={runSearch} disabled={loading}>
              {loading ? <Loader2 className='size-4 animate-spin' /> : <RefreshCw className='size-4' />}
              刷新
            </Button>
          </CardContent>
        </Card>

        <div className='flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground'>
          <span>{loading ? '正在读取举报列表…' : `共 ${total} 条举报，当前显示 ${items.length} 条`}</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </Button>
            <span className='px-1 tabular-nums'>第 {page} / {totalPages} 页</span>
            <Button variant='outline' size='sm' disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
              下一页
            </Button>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-[1fr_380px]'>
          <Card className='overflow-hidden'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>举报人</TableHead>
                    <TableHead>被举报人</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead className='w-20'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className='flex items-center justify-center py-12'>
                          <Loader2 className='size-5 animate-spin text-muted-foreground' />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className='py-12 text-center text-sm text-muted-foreground'>暂无举报记录</div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow
                        key={item.id}
                        className={cn('cursor-pointer', selectedId === item.id && 'bg-muted/60')}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <TableCell>
                          <div className='font-medium'>{item.reporter_nickname || item.reporter_user_id.slice(0, 8)}</div>
                          <div className='text-xs text-muted-foreground'>{item.reporter_user_id.slice(0, 8)}</div>
                        </TableCell>
                        <TableCell>
                          <div className='font-medium'>{item.reported_nickname || item.reported_user_id.slice(0, 8)}</div>
                          <div className='text-xs text-muted-foreground'>{item.reported_user_id.slice(0, 8)}</div>
                        </TableCell>
                        <TableCell>{targetTypeLabels[item.target_type] || item.target_type}</TableCell>
                        <TableCell>{reasonLabels[item.reason] || item.reason}</TableCell>
                        <TableCell>
                          <Badge variant='outline' className={cn(statusBadgeClass[item.status], 'font-normal')}>
                            {statusLabels[item.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                          {new Date(item.created_at).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8 text-destructive hover:text-destructive'
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(item.id)
                            }}
                          >
                            <Trash2 className='size-4' />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className='h-fit'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-lg'>
                <Flag className='size-5' />
                举报详情
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!selected ? (
                <div className='py-12 text-center text-sm text-muted-foreground'>请选择一条举报记录</div>
              ) : (
                <>
                  <div className='space-y-1 text-sm'>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>举报 ID</span>
                      <span className='font-mono'>{selected.id}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>目标</span>
                      <span>{targetTypeLabels[selected.target_type]} / {selected.target_id.slice(0, 8)}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>原因</span>
                      <span>{reasonLabels[selected.reason] || selected.reason}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>当前状态</span>
                      <Badge variant='outline' className={cn(statusBadgeClass[selected.status], 'font-normal')}>
                        {statusLabels[selected.status]}
                      </Badge>
                    </div>
                    {selected.handled_by && (
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>处理人</span>
                        <span>{selected.handled_by} {selected.handled_at ? new Date(selected.handled_at).toLocaleString('zh-CN') : ''}</span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className='space-y-2'>
                    <Label>补充说明</Label>
                    <div className='rounded-md border bg-muted/50 p-3 text-sm whitespace-pre-wrap'>
                      {selected.extra_content || '无'}
                    </div>
                  </div>

                  {detailLoading ? (
                    <div className='space-y-2'>
                      <Skeleton className='h-20 w-full' />
                      <Skeleton className='h-4 w-2/3' />
                    </div>
                  ) : targetSnapshot ? (
                    <div className='space-y-2'>
                      <Label>被举报内容摘要</Label>
                      <div className='rounded-md border bg-muted/50 p-3 text-sm space-y-2'>
                        {targetSnapshot.title && <div className='font-medium'>{targetSnapshot.title}</div>}
                        {targetSnapshot.body && <div className='text-muted-foreground'>{targetSnapshot.body}</div>}
                        {targetSnapshot.description && <div className='text-muted-foreground'>{targetSnapshot.description}</div>}
                        {targetSnapshot.image_urls && targetSnapshot.image_urls.length > 0 && (
                          <div className='flex flex-wrap gap-2 pt-1'>
                            {targetSnapshot.image_urls.map((url, idx) => (
                              <img key={idx} src={url} alt='' className='h-20 w-20 rounded-md object-cover' />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <Separator />

                  <div className='space-y-2'>
                    <Label htmlFor='resolution-note'>处理说明</Label>
                    <Textarea
                      id='resolution-note'
                      value={resolutionNote}
                      onChange={(event) => setResolutionNote(event.target.value)}
                      placeholder='填写处理说明，会一并发送给举报者和被举报者（可选）'
                      rows={4}
                      disabled={updating || selected.status === 'resolved' || selected.status === 'rejected'}
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label>变更状态</Label>
                    <div className='flex flex-wrap gap-2'>
                      {transitionOptions[selected.status].length === 0 ? (
                        <span className='text-sm text-muted-foreground'>该举报已结案</span>
                      ) : (
                        transitionOptions[selected.status].map((nextStatus) => (
                          <Button
                            key={nextStatus}
                            variant='outline'
                            size='sm'
                            disabled={updating}
                            onClick={() => void updateStatus(nextStatus)}
                          >
                            {updating && <Loader2 className='mr-1 size-3 animate-spin' />}
                            标记为 {statusLabels[nextStatus]}
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value, foot, loading }: { label: string; value: string; foot: string; loading?: boolean }) {
  return (
    <Card>
      <CardContent className='pt-6'>
        <p className='text-sm text-muted-foreground'>{label}</p>
        <div className='mt-1 flex items-baseline gap-2'>
          {loading ? <Skeleton className='h-8 w-16' /> : <p className='text-2xl font-semibold'>{value}</p>}
          <span className='text-xs text-muted-foreground'>{foot}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className='space-y-2'>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
