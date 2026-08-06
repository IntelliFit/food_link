import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, displayApiBase } from '@/lib/api'

type PackagedFoodCorrectionsPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type Submission = {
  id: string
  packaged_food_id: string
  user_id: string
  status: string
  reason_type: string
  comment?: string
  proposed_patch?: Record<string, unknown>
  before_snapshot?: Record<string, unknown>
  evidence_image_urls?: string[]
  confidence_score?: number
  risk_flags?: string[]
  review_note?: string | null
}

type PackagedFood = {
  id: string
  display_name?: string
  product_name?: string
  brand?: string
  barcode?: string
  review_status?: string
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type DetailResponse = {
  submission: Submission
  packaged_food: PackagedFood
}

export function PackagedFoodCorrectionsPage({ onLogout, onMenuChange }: PackagedFoodCorrectionsPageProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Submission[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)

  const limit = 40
  const apiBase = displayApiBase()

  useEffect(() => {
    void loadList(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status])

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId)
    }
  }, [selectedId])

  const patchEntries = useMemo(
    () => Object.entries(detail?.submission.proposed_patch || {}).sort(([a], [b]) => a.localeCompare(b)),
    [detail],
  )

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(limit), status })
      if (query.trim()) params.set('q', query.trim())
      const data = await adminRequest<ListResponse<Submission>>(`/api/admin/packaged-food-corrections?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      const nextId = selectedId && data.items.some((item) => item.id === selectedId) ? selectedId : (data.items[0]?.id ?? '')
      setSelectedId(nextId)
      if (!nextId) {
        setDetail(null)
        setReviewNote('')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取纠错提案失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    try {
      const data = await adminRequest<DetailResponse>(`/api/admin/packaged-food-corrections/${encodeURIComponent(id)}`)
      setDetail(data)
      setReviewNote(data.submission.review_note || '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取提案详情失败')
    }
  }

  async function review(action: 'approve' | 'reject') {
    if (!selectedId) return
    setActing(true)
    try {
      const data = await adminRequest<{ detail: DetailResponse; message: string }>(
        `/api/admin/packaged-food-corrections/${encodeURIComponent(selectedId)}/review`,
        { method: 'PATCH', body: JSON.stringify({ action, review_note: reviewNote }) },
      )
      toast.success(data.message || (action === 'approve' ? '已应用提案' : '已驳回提案'))
      setDetail(data.detail)
      await loadList(page)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '审核失败')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='packaged-food-corrections' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <section className='space-y-2'>
          <p className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>Packaged Food Corrections</p>
          <div className='flex items-end justify-between gap-4'>
            <div>
              <h1 className='text-2xl font-semibold tracking-tight'>零食纠错提案</h1>
              <p className='text-sm text-muted-foreground'>审核用户提交的零食库纠错共建提案，并决定是否同步到正式库。</p>
            </div>
            <div className='text-right text-xs text-muted-foreground'>
              <div>API</div>
              <div className='font-mono'>{apiBase}</div>
            </div>
          </div>
        </section>

        <section className='grid gap-4 md:grid-cols-4'>
          <Stat label='当前筛选总数' value={String(total)} foot='条提案' />
          <Stat label='本页显示' value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
          <Stat label='选中状态' value={detail?.submission.status || '-'} foot={detail?.submission.reason_type || ''} />
          <Stat label='正式库条目' value={shortText(detail?.packaged_food.display_name || detail?.packaged_food.product_name || '-')} foot={detail?.packaged_food.review_status || ''} />
        </section>

        <section className='flex flex-wrap items-end gap-3 rounded-2xl border bg-card/90 p-4 shadow-sm'>
          <label className='min-w-[280px] flex-1 text-sm'>
            搜索
            <input
              className='mt-2 h-10 w-full rounded-xl border bg-background px-3'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='评论、条码、差异字段'
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  void loadList(1)
                }
              }}
            />
          </label>
          <label className='text-sm'>
            状态
            <select className='mt-2 h-10 rounded-xl border bg-background px-3' value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <option value='pending'>pending</option>
              <option value='applied'>applied</option>
              <option value='rejected'>rejected</option>
              <option value='all'>all</option>
            </select>
          </label>
          <button className='h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground' onClick={() => { setPage(1); void loadList(1) }}>
            刷新
          </button>
        </section>

        <section className='grid min-h-[640px] gap-6 lg:grid-cols-[360px_minmax(0,1fr)]'>
          <div className='rounded-2xl border bg-card/90 p-3 shadow-sm'>
            <div className='space-y-3'>
              {items.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === item.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'}`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='truncate text-sm font-semibold'>{shortText(readName(item.before_snapshot) || readName(item.proposed_patch) || item.packaged_food_id)}</div>
                      <div className='mt-1 text-xs text-muted-foreground'>{item.reason_type} | {item.status}</div>
                    </div>
                    <div className='text-xs text-muted-foreground'>{Math.round((item.confidence_score || 0) * 100)}%</div>
                  </div>
                  {item.comment ? <p className='mt-3 line-clamp-2 text-xs text-muted-foreground'>{item.comment}</p> : null}
                </button>
              ))}
            </div>
          </div>

          <div className='rounded-2xl border bg-card/90 p-5 shadow-sm'>
            {!detail ? (
              <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>请选择一条提案查看详情。</div>
            ) : (
              <div className='space-y-6'>
                <section className='grid gap-4 md:grid-cols-2'>
                  <InfoCard title='提案信息'>
                    <InfoRow label='提案 ID' value={detail.submission.id} mono />
                    <InfoRow label='状态' value={detail.submission.status} />
                    <InfoRow label='原因' value={detail.submission.reason_type} />
                    <InfoRow label='置信度' value={`${Math.round((detail.submission.confidence_score || 0) * 100)}%`} />
                    <InfoRow label='用户备注' value={detail.submission.comment || '--'} />
                  </InfoCard>
                  <InfoCard title='正式库当前值'>
                    <InfoRow label='商品' value={detail.packaged_food.display_name || detail.packaged_food.product_name || '--'} />
                    <InfoRow label='品牌' value={detail.packaged_food.brand || '--'} />
                    <InfoRow label='条码' value={detail.packaged_food.barcode || '--'} mono />
                    <InfoRow label='review_status' value={detail.packaged_food.review_status || '--'} />
                  </InfoCard>
                </section>

                <section className='space-y-3'>
                  <h2 className='text-sm font-semibold'>字段差异</h2>
                  <div className='overflow-hidden rounded-2xl border'>
                    <table className='w-full text-sm'>
                      <thead className='bg-muted/60 text-left'>
                        <tr>
                          <th className='px-3 py-2'>字段</th>
                          <th className='px-3 py-2'>当前值</th>
                          <th className='px-3 py-2'>提案值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patchEntries.map(([key, value]) => (
                          <tr key={key} className='border-t align-top'>
                            <td className='px-3 py-2 font-mono text-xs'>{key}</td>
                            <td className='px-3 py-2 whitespace-pre-wrap break-all text-muted-foreground'>{formatValue(detail.submission.before_snapshot?.[key])}</td>
                            <td className='px-3 py-2 whitespace-pre-wrap break-all'>{formatValue(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className='space-y-3 rounded-2xl border p-4'>
                  <h2 className='text-sm font-semibold'>审核操作</h2>
                  <textarea className='min-h-[96px] w-full rounded-xl border bg-background px-3 py-2 text-sm' value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder='审核备注，可选' />
                  <div className='flex flex-wrap gap-3'>
                    <button className='rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50' disabled={acting || detail.submission.status !== 'pending'} onClick={() => void review('approve')}>
                      应用到正式库
                    </button>
                    <button className='rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50' disabled={acting || detail.submission.status !== 'pending'} onClick={() => void review('reject')}>
                      驳回提案
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return <div className='rounded-2xl border bg-card/90 p-4 shadow-sm'><div className='text-xs text-muted-foreground'>{label}</div><div className='mt-2 text-lg font-semibold'>{value}</div>{foot ? <div className='mt-1 text-xs text-muted-foreground'>{foot}</div> : null}</div>
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className='rounded-2xl border p-4'><h2 className='text-sm font-semibold'>{title}</h2><div className='mt-3 space-y-2'>{children}</div></div>
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className='flex items-start justify-between gap-4 text-sm'><span className='shrink-0 text-muted-foreground'>{label}</span><span className={`text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span></div>
}

function formatValue(value: unknown) {
  if (value == null || value === '') return '--'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function readName(payload?: Record<string, unknown>) {
  if (!payload) return ''
  return String(payload.display_name || payload.product_name || '')
}

function shortText(value: string) {
  const text = String(value || '')
  return text.length > 18 ? `${text.slice(0, 18)}...` : text
}
