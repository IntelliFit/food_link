import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminRequest } from '@/lib/api'
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
  reported_user_id: string
  reported_nickname: string
  target_type: FeedReportTargetType
  target_id: string
  reason: string
  reason_name: string
  status: FeedReportStatus
  created_at: string
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

export function FeedReportPage({ onLogout, onMenuChange }: FeedReportPageProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [targetType, setTargetType] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [items, setItems] = useState<FeedReportItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, status, targetType])

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='feed-reports' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-4 pb-8'>
        <Card className='border bg-card/90 shadow-lg backdrop-blur-md'>
          <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
            <div className='space-y-2'>
              <p className='text-sm font-medium text-primary'>社区治理</p>
              <CardTitle className='text-3xl tracking-tight'>举报管理</CardTitle>
              <CardDescription className='max-w-2xl text-base leading-relaxed'>
                查看、受理用户举报。点击任意一行进入举报详情页进行处理。
              </CardDescription>
            </div>
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

        <Card>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className='flex items-center justify-center py-12'>
                        <Loader2 className='size-5 animate-spin text-muted-foreground' />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className='py-12 text-center text-sm text-muted-foreground'>暂无举报记录</div>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow
                      key={item.id}
                      className='cursor-pointer'
                      onClick={() => navigate(`/feed-reports/${encodeURIComponent(item.id)}`)}
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
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
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
