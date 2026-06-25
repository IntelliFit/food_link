import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, Play, RefreshCw, Clock, Database, Hash } from 'lucide-react'

type PackagedFood = {
  id: string
  brand: string
  product_name: string
  display_name: string
  source_image_urls?: string[]
}

type TestRun = {
  id: string
  packaged_food_id: string
  status: string
  result?: {
    brand?: string
    product_name?: string
    display_name?: string
    unit_nutrition_per_100g?: Record<string, number>
    conversion_status?: string
    auto_ingest_result?: {
      status?: string
      reason?: string
    }
    [key: string]: any
  }
  metadata: {
    duration_ms: number
    model?: string
    response_id?: string
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    raw_meta?: Record<string, any>
  }
  error_message?: string
  started_at?: string
  completed_at?: string
  created_at?: string
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type PackagedFoodTestRunsPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

export function PackagedFoodTestRunsPage({ onLogout, onMenuChange }: PackagedFoodTestRunsPageProps) {
  const navigate = useNavigate()
  const { foodId } = useParams<{ foodId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoRun = searchParams.get('auto') === '1'

  const [food, setFood] = useState<PackagedFood | null>(null)
  const [runs, setRuns] = useState<TestRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [selectedRun, setSelectedRun] = useState<TestRun | null>(null)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)

  useEffect(() => {
    if (!foodId) return
    void loadFood()
    void loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodId, page, limit])

  useEffect(() => {
    if (autoRun && foodId && !running && runs.length === 0 && !loading) {
      void triggerRun()
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, foodId, runs.length, loading])

  async function loadFood() {
    try {
      const data = await adminRequest<{ item: PackagedFood }>(`/api/admin/packaged-foods/${encodeURIComponent(foodId!)}`)
      setFood(data.item)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载商品失败')
    }
  }

  async function loadRuns() {
    if (!foodId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      const data = await adminRequest<ListResponse<TestRun>>(
        `/api/admin/packaged-foods/${encodeURIComponent(foodId)}/test-runs?${params.toString()}`
      )
      setRuns(data.items || [])
      setTotal(data.total || 0)
      if (data.items && data.items.length > 0 && !selectedRun) {
        setSelectedRun(data.items[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载运行记录失败')
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  async function triggerRun() {
    if (!foodId || running) return
    setRunning(true)
    try {
      const data = await adminRequest<{ run: TestRun }>(
        `/api/admin/packaged-foods/${encodeURIComponent(foodId)}/test-extract`,
        { method: 'POST' }
      )
      // eslint-disable-next-line no-console
      console.log('[test-run] created', data.run)
      toast.success(data.run.status === 'success' ? '识别完成' : '识别返回失败状态')
      setRuns((prev) => {
        const filtered = prev.filter((r) => r.id !== data.run.id)
        return [data.run, ...filtered]
      })
      setSelectedRun(data.run)
      void loadRuns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '识别失败')
    } finally {
      setRunning(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='packaged-food-test' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-4 pb-8'>
        <Card className='border bg-card/90 shadow-lg backdrop-blur-md'>
          <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
            <div className='space-y-2'>
              <p className='text-sm font-medium text-primary'>实验工具 / 包装食品 / 运行记录</p>
              <CardTitle className='text-3xl tracking-tight'>包装食品识别运行记录</CardTitle>
              <CardDescription className='max-w-2xl text-base leading-relaxed'>
                {food
                  ? `${food.display_name || food.product_name || '未命名'} 的历次识别运行结果，可追溯 ID、耗时与 Token。`
                  : '查看历次识别运行结果，可追溯 ID、耗时与 Token。'}
              </CardDescription>
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => navigate('/packaged-food-test')}>
                <ChevronLeft className='mr-1 size-4' />
                返回商品列表
              </Button>
              <Button onClick={triggerRun} disabled={running}>
                {running ? <RefreshCw className='mr-1 size-4 animate-spin' /> : <Play className='mr-1 size-4' />}
                再运行一次
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className='grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]'>
          <Card>
            <CardHeader>
              <CardTitle>运行记录</CardTitle>
              <CardDescription>共 {total} 条</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {loading && runs.length === 0 ? (
                <div className='space-y-2'>
                  <Skeleton className='h-16 w-full' />
                  <Skeleton className='h-16 w-full' />
                  <Skeleton className='h-16 w-full' />
                </div>
              ) : runs.length === 0 ? (
                <div className='py-8 text-center text-muted-foreground'>
                  暂无运行记录
                  <div className='mt-2'>
                    <Button size='sm' onClick={triggerRun} disabled={running}>
                      {running ? <RefreshCw className='mr-1 size-4 animate-spin' /> : <Play className='mr-1 size-4' />}
                      立即运行
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='space-y-2'>
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRun(run)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
                        selectedRun?.id === run.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : ''
                      }`}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <div className='flex items-center gap-2 text-sm'>
                          <Hash className='size-4 text-muted-foreground' />
                          <span className='font-mono'>{run.id.slice(0, 8)}</span>
                          <RunStatusBadge status={run.status} />
                        </div>
                        <span className='text-xs text-muted-foreground'>
                          {run.completed_at ? formatTime(run.completed_at) : formatTime(run.created_at || '')}
                        </span>
                      </div>
                      <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                        <span className='flex items-center gap-1'>
                          <Clock className='size-3' />
                          {run.metadata?.duration_ms ?? 0} ms
                        </span>
                        <span className='flex items-center gap-1'>
                          <Database className='size-3' />
                          tokens: {run.metadata?.total_tokens ?? run.metadata?.input_tokens ?? 0}
                        </span>
                        {run.metadata?.model && <span>model: {run.metadata.model}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className='flex items-center justify-between pt-2'>
                <div className='text-sm text-muted-foreground'>
                  第 {page} / {totalPages} 页
                </div>
                <div className='flex gap-2'>
                  <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className='flex flex-col'>
            <CardHeader>
              <CardTitle>运行详情</CardTitle>
              <CardDescription>{selectedRun ? `ID: ${selectedRun.id}` : '选择左侧记录查看详情'}</CardDescription>
            </CardHeader>
            <CardContent className='flex-1 overflow-auto'>
              {!selectedRun ? (
                <div className='py-8 text-center text-muted-foreground'>请选择一条运行记录</div>
              ) : (
                <div className='space-y-4'>
                  <div className='grid grid-cols-2 gap-2 text-sm'>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>状态</div>
                      <RunStatusText status={selectedRun.status} />
                    </div>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>耗时</div>
                      <div>{selectedRun.metadata?.duration_ms ?? 0} ms</div>
                    </div>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>Input Tokens</div>
                      <div>{selectedRun.metadata?.input_tokens ?? '-'}</div>
                    </div>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>Output Tokens</div>
                      <div>{selectedRun.metadata?.output_tokens ?? '-'}</div>
                    </div>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>Total Tokens</div>
                      <div>{selectedRun.metadata?.total_tokens ?? '-'}</div>
                    </div>
                    <div className='rounded bg-muted p-2'>
                      <div className='text-muted-foreground'>模型</div>
                      <div className='break-all'>{selectedRun.metadata?.model || '-'}</div>
                    </div>
                  </div>

                  {selectedRun.error_message && (
                    <div className='rounded bg-destructive/10 p-3 text-sm text-destructive'>
                      {selectedRun.error_message}
                    </div>
                  )}

                  {selectedRun.result && (
                    <div className='space-y-2'>
                      <div className='text-sm font-medium text-muted-foreground'>识别结果 JSON</div>
                      <pre className='max-h-[500px] overflow-auto rounded bg-muted p-3 text-xs'>
                        {JSON.stringify(selectedRun.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedRun.metadata?.raw_meta && Object.keys(selectedRun.metadata.raw_meta).length > 0 && (
                    <div className='space-y-2'>
                      <div className='text-sm font-medium text-muted-foreground'>上游原始元数据</div>
                      <pre className='max-h-[300px] overflow-auto rounded bg-muted p-3 text-xs'>
                        {JSON.stringify(selectedRun.metadata.raw_meta, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge variant='default'>成功</Badge>
  if (status === 'running' || status === 'pending') return <Badge variant='secondary'>运行中</Badge>
  return <Badge variant='destructive'>失败</Badge>
}

function RunStatusText({ status }: { status: string }) {
  if (status === 'success') return <span>成功</span>
  if (status === 'running' || status === 'pending') return <span>运行中</span>
  return <span className='text-destructive'>失败</span>
}

function formatTime(value: string): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
