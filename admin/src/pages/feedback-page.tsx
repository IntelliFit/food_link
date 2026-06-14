import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, RefreshCw, Search } from 'lucide-react'
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
import { adminRequest, copyText, displayApiBase } from '@/lib/api'
import { displayUser, firstTraceId, formatTime, formatTraceStatusCode, parseConsoleLogs, shortId, truncate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ConsoleLogEntry, FeedbackItem, FeedbackListResponse, FeedbackStatus, RecentRequestTrace } from '@/types/feedback'
import { categoryLabels, statusLabels } from '@/types/feedback'

type FeedbackPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

const statusBadgeClass: Record<FeedbackStatus, string> = {
  open: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-border bg-muted text-muted-foreground',
}

/** 意见反馈管理页 */
export function FeedbackPage({ onLogout, onMenuChange }: FeedbackPageProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0],
    [items, selectedId],
  )
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, category, status])

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        category,
        status,
      })
      const data = await adminRequest<FeedbackListResponse>(`/api/admin/feedback?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedId((current) => current || data.items?.[0]?.id || '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(id: string, nextStatus: FeedbackStatus) {
    try {
      const data = await adminRequest<{ item: FeedbackItem }>(
        `/api/admin/feedback/${encodeURIComponent(id)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        },
      )
      setItems((current) => current.map((item) => (item.id === id ? data.item : item)))
      setSelectedId(id)
      toast.success('状态已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '状态更新失败')
    }
  }

  async function handleCopy(text: string, label = '已复制') {
    try {
      await copyText(text)
      toast.success(label)
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="feedback" onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className="min-w-0 space-y-4 pb-8">
        <Card className="border bg-card/90 shadow-lg backdrop-blur-md">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-2">
              <p className="text-sm font-medium text-primary">用户声音 / Trace 诊断</p>
              <CardTitle className="text-3xl tracking-tight">意见反馈</CardTitle>
              <CardDescription className="max-w-2xl text-base leading-relaxed">
                集中查看小程序用户反馈，快速复制 traceId、定位最近请求链路，并跟进处理状态。
              </CardDescription>
            </div>
            <Badge variant="outline" className="max-w-xs shrink-0 whitespace-normal break-all px-3 py-1.5 text-xs font-normal">
              API: {displayApiBase()}
            </Badge>
          </CardHeader>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="当前筛选" value={String(total)} foot="条反馈" loading={loading} />
          <StatCard label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} loading={loading} />
          <StatCard
            label="最近提交"
            value={items[0] ? formatTime(items[0].created_at, true) : '-'}
            foot="按提交时间倒序"
            loading={loading && items.length === 0}
          />
        </div>

        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-[minmax(280px,2fr)_160px_150px_110px_auto] md:items-end">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="search">搜索</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') runSearch()
                  }}
                  placeholder="反馈内容 / 联系方式 / traceId / requestId / userId"
                />
              </div>
            </div>
            <FilterSelect label="类型" value={category} onValueChange={(value) => { setCategory(value); setPage(1) }} options={[
              { value: 'all', label: '全部类型' },
              { value: 'bug', label: '问题反馈' },
              { value: 'suggestion', label: '功能建议' },
              { value: 'experience', label: '使用体验' },
              { value: 'other', label: '其他' },
            ]} />
            <FilterSelect label="状态" value={status} onValueChange={(value) => { setStatus(value); setPage(1) }} options={[
              { value: 'all', label: '全部状态' },
              { value: 'open', label: '待处理' },
              { value: 'processing', label: '处理中' },
              { value: 'resolved', label: '已解决' },
              { value: 'closed', label: '已关闭' },
            ]} />
            <FilterSelect label="每页" value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setPage(1) }} options={[
              { value: '20', label: '20' },
              { value: '30', label: '30' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]} />
            <Button className="md:self-end" onClick={runSearch} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span>{loading ? '正在读取反馈列表…' : `共 ${total} 条反馈，当前显示 ${items.length} 条`}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </Button>
            <span className="px-1 tabular-nums">第 {page} / {totalPages} 页</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
              下一页
            </Button>
          </div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
          <div className="space-y-3">
            {loading && items.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                  <CardContent className="space-y-3 pt-6">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardContent>
                </Card>
              ))
            ) : items.length === 0 ? (
              <EmptyState title="没有反馈" desc="换个筛选条件，或等待用户提交新的反馈。" />
            ) : (
              items.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  selected={item.id === selected?.id}
                  onClick={() => setSelectedId(item.id)}
                  onCopy={handleCopy}
                />
              ))
            )}
          </div>

          <Card className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <CardContent className="p-5">
              {selected ? (
                <FeedbackDetail item={selected} onStatusChange={updateStatus} onCopy={handleCopy} />
              ) : (
                <EmptyState title="选择一条反馈" desc="右侧会展示用户、联系方式、提交 trace、客户端信息和最近请求列表。" />
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
      <CardContent className="space-y-1 pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="h-8 w-24" /> : <p className="text-3xl font-semibold tracking-tight">{value}</p>}
        <p className="text-xs text-muted-foreground">{foot}</p>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
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

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 p-8 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-2xl text-primary">⌁</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}

function FeedbackCard({
  item,
  selected,
  onClick,
  onCopy,
}: {
  item: FeedbackItem
  selected: boolean
  onClick: () => void
  onCopy: (text: string, label?: string) => Promise<void>
}) {
  const trace = item.submit_trace_id || firstTraceId(item)
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:border-primary/30 hover:shadow-md',
        selected && 'border-primary/40 ring-2 ring-primary/15',
      )}
      onClick={onClick}
    >
      <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{categoryLabels[item.category] || item.category}</Badge>
            <Badge variant="outline" className={statusBadgeClass[item.status]}>
              {statusLabels[item.status] || item.status}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatTime(item.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{truncate(item.content, 220)}</p>
          <div className="flex flex-wrap gap-2">
            <MetaChip>{displayUser(item)}</MetaChip>
            <MetaChip>{item.app_version ? `v${item.app_version}` : '未知版本'}</MetaChip>
            <MetaChip>{item.recent_requests?.length || 0} 条请求</MetaChip>
            <MetaChip>{trace ? `trace ${shortId(trace)}` : '无 trace'}</MetaChip>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <Button
            variant="outline"
            size="sm"
            disabled={!trace}
            onClick={(event) => {
              event.stopPropagation()
              void onCopy(trace, 'trace 已复制')
            }}
          >
            <Copy className="size-3.5" />
            复制 trace
          </Button>
          <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); onClick() }}>
            查看详情
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

function FeedbackDetail({
  item,
  onStatusChange,
  onCopy,
}: {
  item: FeedbackItem
  onStatusChange: (id: string, status: FeedbackStatus) => Promise<void>
  onCopy: (text: string, label?: string) => Promise<void>
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{categoryLabels[item.category] || item.category}</Badge>
          <Badge variant="outline" className={statusBadgeClass[item.status]}>
            {statusLabels[item.status] || item.status}
          </Badge>
        </div>
        <Select value={item.status} onValueChange={(value) => void onStatusChange(item.id, value as FeedbackStatus)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(statusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">反馈内容</h3>
        <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">{item.content}</p>
      </section>

      {item.image_urls?.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">截图 ({item.image_urls.length})</h3>
          <div className="grid grid-cols-2 gap-3">
            {item.image_urls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border bg-muted/20"
              >
                <img src={url} alt="反馈截图" className="aspect-[4/3] w-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">提交信息</h3>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <DetailKV label="反馈 ID" value={item.id} />
          <DetailKV label="用户" value={displayUser(item)} />
          <DetailKV label="用户 ID" value={item.user_id} />
          <DetailKV label="联系方式" value={item.contact || '未填写'} />
          <DetailKV label="手机号" value={item.user_telephone || '未绑定'} />
          <DetailKV label="页面" value={item.page_path || '未知'} />
          <DetailKV label="版本" value={item.app_version ? `v${item.app_version}` : '未知'} />
          <DetailKV label="提交时间" value={formatTime(item.created_at)} />
          <DetailKV label="submit trace" value={item.submit_trace_id || '无'} />
          <DetailKV label="submit request" value={item.submit_request_id || '无'} />
          <DetailKV label="host" value={item.submit_host_name || '无'} />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy(item.id, '反馈 ID 已复制')}>
            <Copy className="size-3.5" />
            复制反馈 ID
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!item.submit_trace_id}
            onClick={() => void onCopy(item.submit_trace_id, '提交 trace 已复制')}
          >
            <Copy className="size-3.5" />
            复制提交 trace
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">客户端信息</h3>
        <pre className="max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-emerald-100">
          {JSON.stringify(stripConsoleLogsFromClientInfo(item.client_info || {}), null, 2)}
        </pre>
      </section>

      <ConsoleLogsSection logs={parseConsoleLogs(item.client_info)} />

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">最近请求 ({item.recent_requests?.length || 0})</h3>
        {item.recent_requests?.length ? (
          <div className="space-y-2">
            {item.recent_requests.map((trace, index) => (
              <TraceCard key={`${trace.traceId || trace.trace_id || index}-${index}`} trace={trace} index={index} onCopy={onCopy} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">用户未附带最近请求诊断。</p>
        )}
      </section>
    </div>
  )
}

function stripConsoleLogsFromClientInfo(clientInfo: Record<string, unknown>): Record<string, unknown> {
  const { console_logs: _ignored, ...rest } = clientInfo
  return rest
}

function ConsoleLogsSection({ logs }: { logs: ConsoleLogEntry[] }) {
  if (!logs.length) return null
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Console 日志 ({logs.length})</h3>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-2">
        {logs.map((entry, index) => (
          <div key={`${entry.at || index}-${index}`} className="rounded-md border bg-background px-3 py-2 text-xs">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {entry.level || 'log'}
              </Badge>
              <span>{entry.at ? formatTime(entry.at) : '未知时间'}</span>
            </div>
            <pre className="whitespace-pre-wrap break-all font-mono leading-relaxed text-foreground">{entry.message || ''}</pre>
          </div>
        ))}
      </div>
    </section>
  )
}

function DetailKV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value || '无'}</dd>
    </>
  )
}

function TraceCard({
  trace,
  index,
  onCopy,
}: {
  trace: RecentRequestTrace
  index: number
  onCopy: (text: string, label?: string) => Promise<void>
}) {
  const traceId = trace.traceId || trace.trace_id || ''
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {index + 1}. {trace.method || 'GET'} · {formatTraceStatusCode(trace)} · {trace.durationMs ?? trace.duration_ms ?? 0}ms
        </p>
        <Button variant="ghost" size="sm" disabled={!traceId} onClick={() => void onCopy(traceId, 'trace 已复制')}>
          <Copy className="size-3.5" />
          复制
        </Button>
      </div>
      <p className="mt-1 break-all text-xs text-muted-foreground">{trace.path || '/'}</p>
      {(trace.errorMessage || trace.error_message) ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {trace.errorMessage || trace.error_message}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <DetailKV label="traceId" value={traceId || '无'} />
        <DetailKV label="requestId" value={trace.requestId || trace.request_id || '无'} />
        <DetailKV label="host" value={trace.hostName || trace.host_name || '无'} />
        <DetailKV label="startedAt" value={trace.startedAt || trace.started_at || '无'} />
        {(trace.errorMessage || trace.error_message) ? (
          <DetailKV label="error" value={trace.errorMessage || trace.error_message || ''} />
        ) : null}
      </dl>
    </div>
  )
}
