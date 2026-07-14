import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Bot, Check, Loader2, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, displayApiBase } from '@/lib/api'

type PageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type AliasCandidate = {
  id: string
  alias_name: string
  normalized_alias: string
  proposed_food_id: string
  proposed_canonical_name: string
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  source: string
  source_task_id?: string
  model?: string
  model_decision?: 'approve' | 'reject' | 'manual_review' | 'suggested'
  model_confidence?: number
  model_reason?: string
  suggested_aliases: string[]
  rule_flags: string[]
  status: 'pending' | 'approved' | 'rejected'
  reviewer_id?: string
  reviewed_at?: string
  review_note?: string
  generated_from_id?: string
  created_at: string
}

type FoodNutrition = {
  id: string
  canonical_name: string
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  is_active: boolean
}

type ListResponse<T> = { items: T[]; page: number; limit: number; total: number }

const statusLabels: Record<AliasCandidate['status'], string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

const decisionLabels: Record<string, string> = {
  approve: '建议通过',
  reject: '建议拒绝',
  manual_review: '建议人工复核',
  suggested: 'AI 新生成',
}

export function NutritionAliasReviewPage({ onLogout, onMenuChange }: PageProps) {
  const [items, setItems] = useState<AliasCandidate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('pending')
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [batching, setBatching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [nonce, setNonce] = useState(0)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )
  const totalPages = Math.max(1, Math.ceil(total / 40))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source, page, nonce])

  async function loadList() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q: query.trim(), status, source, page: String(page), limit: '40',
      })
      const data = await adminRequest<ListResponse<AliasCandidate>>(`/api/admin/nutrition-alias-candidates?${params}`)
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
      setSelectedId((current) => data.items?.some((item) => item.id === current) ? current : data.items?.[0]?.id ?? '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取别名候选失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  function refresh() {
    setPage(1)
    setNonce((value) => value + 1)
  }

  async function runAIReview(id: string) {
    setWorkingId(id)
    try {
      const data = await adminRequest<{ item: AliasCandidate; generated_candidates: number }>(
        `/api/admin/nutrition-alias-candidates/${encodeURIComponent(id)}/ai-review`,
        { method: 'POST' },
      )
      setItems((current) => current.map((item) => item.id === id ? data.item : item))
      toast.success(data.generated_candidates > 0
        ? `预审完成，并新增 ${data.generated_candidates} 条待审别名`
        : '预审完成，结果仍需人工确认')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 预审失败')
    } finally {
      setWorkingId('')
    }
  }

  async function runBatchAIReview() {
    if (!window.confirm('将逐条调用 DeepSeek V4 Pro 预审前 10 条待审记录。模型结果不会自动通过，是否继续？')) return
    setBatching(true)
    try {
      const data = await adminRequest<{ result: { requested: number; succeeded: number; failed: number } }>(
        '/api/admin/nutrition-alias-candidates/ai-review-batch',
        { method: 'POST', body: JSON.stringify({ limit: 10 }) },
      )
      toast.success(`预审完成：成功 ${data.result.succeeded}，失败 ${data.result.failed}`)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量预审失败')
    } finally {
      setBatching(false)
    }
  }

  async function review(item: AliasCandidate, decision: 'approved' | 'rejected') {
    const verb = decision === 'approved' ? '通过并写入正式别名库' : '拒绝'
    if (!window.confirm(`确定${verb}“${item.alias_name} → ${item.proposed_canonical_name}”吗？`)) return
    const note = window.prompt('审核备注（可选）', item.model_reason ?? '')
    if (note === null) return
    setWorkingId(item.id)
    try {
      const data = await adminRequest<{ item: AliasCandidate }>(
        `/api/admin/nutrition-alias-candidates/${encodeURIComponent(item.id)}/review`,
        { method: 'POST', body: JSON.stringify({ decision, note }) },
      )
      if (status === 'pending') {
        setItems((current) => current.filter((row) => row.id !== item.id))
        setTotal((value) => Math.max(0, value - 1))
      } else {
        setItems((current) => current.map((row) => row.id === item.id ? data.item : row))
      }
      toast.success(decision === 'approved' ? '已通过并发布正式别名' : '已拒绝')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '审核失败')
    } finally {
      setWorkingId('')
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='nutrition-alias-review' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <header className='page-header'>
          <div>
            <p className='eyebrow'>识别算法 / 营养数据库</p>
            <h1>营养别名审核</h1>
            <p className='mt-2 max-w-3xl text-sm text-muted-foreground'>
              AI 只提供预审意见和严格等价别名建议。只有管理员点击通过后，候选才会进入线上正式匹配库。
            </p>
          </div>
          <div className='api-pill'>API: {displayApiBase()}</div>
        </header>

        <section className='grid gap-4 md:grid-cols-3'>
          <StatCard label='当前队列' value={String(total)} hint={statusLabels[status as AliasCandidate['status']] ?? '全部状态'} />
          <StatCard label='本页已预审' value={String(items.filter((item) => item.model_decision).length)} hint='仍需人工确认' />
          <StatCard label='安全策略' value='双门禁' hint='AI 建议 + 后端硬规则' />
        </section>

        <section className='rounded-2xl border bg-card p-4 shadow-sm'>
          <div className='flex flex-wrap items-end gap-3'>
            <label className='min-w-64 flex-1 text-sm'>
              搜索别名或目标食物
              <input className='mt-1 w-full rounded-lg border bg-background px-3 py-2' value={query}
                onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && refresh()}
                placeholder='例如：牛肉面、瘦牛肉' />
            </label>
            <Filter label='状态' value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={[
              ['pending', '待审核'], ['approved', '已通过'], ['rejected', '已拒绝'], ['all', '全部'],
            ]} />
            <Filter label='来源' value={source} onChange={(value) => { setSource(value); setPage(1) }} options={[
              ['all', '全部'], ['admin_manual', '人工创建'], ['ai_generated', 'AI 生成'], ['ai_semantic', '识别链路'], ['audit_scan', '审计扫描'],
            ]} />
            <button className='inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm' onClick={refresh}>
              <RefreshCw className='size-4' />刷新
            </button>
            <button className='inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm' onClick={() => setShowCreate(true)}>
              <Plus className='size-4' />新建候选
            </button>
            <button className='inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
              disabled={batching} onClick={() => void runBatchAIReview()}>
              {batching ? <Loader2 className='size-4 animate-spin' /> : <Bot className='size-4' />}Pro 预审 10 条
            </button>
          </div>
        </section>

        <section className='grid min-h-[620px] grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)] overflow-hidden rounded-2xl border bg-card shadow-sm'>
          <div className='border-r p-3'>
            {loading ? <LoadingRows /> : null}
            {!loading && items.length === 0 ? <EmptyState /> : null}
            <div className='space-y-2'>
              {!loading && items.map((item) => (
                <button key={item.id} type='button' onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === item.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <strong className='block truncate text-base'>{item.alias_name}</strong>
                      <span className='text-sm text-muted-foreground'>→ {item.proposed_canonical_name}</span>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className='mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                    <span>{sourceLabel(item.source)}</span>
                    {item.model_decision ? <span>{decisionLabels[item.model_decision] ?? item.model_decision}</span> : <span>未预审</span>}
                    {item.model_confidence !== undefined ? <span>{Math.round(item.model_confidence * 100)}%</span> : null}
                  </div>
                </button>
              ))}
            </div>
            <div className='mt-4 flex items-center justify-between text-sm text-muted-foreground'>
              <button className='rounded-lg border px-3 py-1.5 disabled:opacity-40' disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
              <span>{page} / {totalPages}</span>
              <button className='rounded-lg border px-3 py-1.5 disabled:opacity-40' disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
            </div>
          </div>
          <aside className='p-6'>
            {selected ? (
              <CandidateDetail item={selected} working={workingId === selected.id}
                onAIReview={runAIReview} onReview={review} />
            ) : <EmptyState detail />}
          </aside>
        </section>
      </main>
      {showCreate ? <CreateCandidateModal onClose={() => setShowCreate(false)} onCreated={(item) => {
        setShowCreate(false); setStatus('pending'); setPage(1); setSelectedId(item.id); setNonce((value) => value + 1)
      }} /> : null}
    </div>
  )
}

function CandidateDetail({ item, working, onAIReview, onReview }: {
  item: AliasCandidate
  working: boolean
  onAIReview: (id: string) => Promise<void>
  onReview: (item: AliasCandidate, decision: 'approved' | 'rejected') => Promise<void>
}) {
  return (
    <div className='space-y-6'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <p className='text-sm text-muted-foreground'>候选映射</p>
          <h2 className='mt-1 text-2xl font-semibold'>{item.alias_name} <span className='text-muted-foreground'>→</span> {item.proposed_canonical_name}</h2>
          <p className='mt-2 break-all text-xs text-muted-foreground'>{item.id}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className='grid grid-cols-4 gap-3'>
        <Macro label='热量' value={`${cleanNum(item.kcal_per_100g)} kcal`} />
        <Macro label='蛋白质' value={`${cleanNum(item.protein_per_100g)} g`} />
        <Macro label='碳水' value={`${cleanNum(item.carbs_per_100g)} g`} warn={item.alias_name.includes('面') && item.carbs_per_100g <= 2} />
        <Macro label='脂肪' value={`${cleanNum(item.fat_per_100g)} g`} />
      </div>

      <section className='rounded-xl border p-4'>
        <div className='flex items-center gap-2 font-medium'><Bot className='size-4' />AI 预审</div>
        {item.model_decision ? (
          <div className='mt-3 space-y-2 text-sm'>
            <p><strong>{decisionLabels[item.model_decision] ?? item.model_decision}</strong>{item.model_confidence !== undefined ? ` · 置信度 ${Math.round(item.model_confidence * 100)}%` : ''}</p>
            <p className='leading-6 text-muted-foreground'>{item.model_reason || '无理由'}</p>
            {item.rule_flags?.length ? <TagList title='风险标记' values={item.rule_flags} danger /> : null}
            {item.suggested_aliases?.length ? <TagList title='生成的等价别名（均进入待审队列）' values={item.suggested_aliases} /> : null}
            <p className='text-xs text-muted-foreground'>模型：{item.model || '-'}</p>
          </div>
        ) : <p className='mt-3 text-sm text-muted-foreground'>尚未调用 Pro。可直接人工判断，也可先让模型给出建议。</p>}
      </section>

      <section className='rounded-xl border p-4 text-sm'>
        <div className='flex items-center gap-2 font-medium'><ShieldCheck className='size-4' />审计信息</div>
        <dl className='mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-muted-foreground'>
          <dt>来源</dt><dd>{sourceLabel(item.source)}</dd>
          <dt>目标食物 ID</dt><dd className='break-all'>{item.proposed_food_id}</dd>
          <dt>来源任务</dt><dd className='break-all'>{item.source_task_id || '-'}</dd>
          <dt>创建时间</dt><dd>{formatTime(item.created_at)}</dd>
          <dt>审核人</dt><dd className='break-all'>{item.reviewer_id || '-'}</dd>
          <dt>审核备注</dt><dd>{item.review_note || '-'}</dd>
        </dl>
      </section>

      {item.status === 'pending' ? (
        <div className='flex flex-wrap gap-3'>
          <button className='inline-flex items-center gap-2 rounded-lg border px-4 py-2 disabled:opacity-50' disabled={working} onClick={() => void onAIReview(item.id)}>
            {working ? <Loader2 className='size-4 animate-spin' /> : <Bot className='size-4' />}AI 预审
          </button>
          <button className='inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-50' disabled={working} onClick={() => void onReview(item, 'approved')}>
            <Check className='size-4' />通过并发布
          </button>
          <button className='inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground disabled:opacity-50' disabled={working} onClick={() => void onReview(item, 'rejected')}>
            <X className='size-4' />拒绝
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CreateCandidateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (item: AliasCandidate) => void }) {
  const [aliasName, setAliasName] = useState('')
  const [foodQuery, setFoodQuery] = useState('')
  const [foods, setFoods] = useState<FoodNutrition[]>([])
  const [selectedFood, setSelectedFood] = useState<FoodNutrition | null>(null)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  async function searchFoods() {
    if (!foodQuery.trim()) return
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: foodQuery.trim(), active: 'true', page: '1', limit: '10' })
      const data = await adminRequest<ListResponse<FoodNutrition>>(`/api/admin/food-nutrition?${params}`)
      setFoods(data.items ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索食物失败')
    } finally {
      setSearching(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedFood) {
      toast.error('请先选择目标食物')
      return
    }
    setSaving(true)
    try {
      const data = await adminRequest<{ item: AliasCandidate }>('/api/admin/nutrition-alias-candidates', {
        method: 'POST', body: JSON.stringify({ alias_name: aliasName.trim(), proposed_food_id: selectedFood.id }),
      })
      toast.success('已加入待审核队列')
      onCreated(data.item)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建候选失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='fixed inset-0 z-50 grid place-items-center bg-black/50 p-4' onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className='w-full max-w-2xl space-y-5 rounded-2xl border bg-card p-6 shadow-2xl' onSubmit={(event) => void submit(event)}>
        <div className='flex items-center justify-between'><h2 className='text-xl font-semibold'>新建别名候选</h2><button type='button' onClick={onClose}><X className='size-5' /></button></div>
        <label className='block text-sm'>别名<input required value={aliasName} onChange={(event) => setAliasName(event.target.value)} className='mt-1 w-full rounded-lg border bg-background px-3 py-2' placeholder='例如：兰州牛肉拉面' /></label>
        <div>
          <label className='block text-sm'>搜索目标食物</label>
          <div className='mt-1 flex gap-2'><input value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchFoods() } }} className='min-w-0 flex-1 rounded-lg border bg-background px-3 py-2' placeholder='输入标准名称' /><button type='button' className='rounded-lg border px-4' onClick={() => void searchFoods()}>{searching ? <Loader2 className='size-4 animate-spin' /> : '搜索'}</button></div>
          <div className='mt-2 max-h-56 space-y-2 overflow-auto'>
            {foods.map((food) => <button key={food.id} type='button' onClick={() => setSelectedFood(food)} className={`w-full rounded-lg border p-3 text-left ${selectedFood?.id === food.id ? 'border-primary bg-primary/5' : ''}`}>
              <strong>{food.canonical_name}</strong><span className='ml-3 text-xs text-muted-foreground'>{cleanNum(food.kcal_per_100g)} kcal · P {cleanNum(food.protein_per_100g)} · C {cleanNum(food.carbs_per_100g)} · F {cleanNum(food.fat_per_100g)}</span>
            </button>)}
          </div>
        </div>
        <p className='rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground'>创建时会先执行形态和主食碳水硬校验；即使创建成功，也不会进入正式匹配库，必须再次人工通过。</p>
        <div className='flex justify-end gap-3'><button type='button' className='rounded-lg border px-4 py-2' onClick={onClose}>取消</button><button disabled={saving} className='rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50'>{saving ? <Loader2 className='size-4 animate-spin' /> : '加入待审队列'}</button></div>
      </form>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className='rounded-2xl border bg-card p-5 shadow-sm'><span className='text-sm text-muted-foreground'>{label}</span><strong className='mt-2 block text-3xl'>{value}</strong><span className='mt-1 block text-xs text-muted-foreground'>{hint}</span></article>
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className='text-sm'>{label}<select className='mt-1 block rounded-lg border bg-background px-3 py-2' value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
}

function StatusBadge({ status }: { status: AliasCandidate['status'] }) {
  const style = status === 'approved' ? 'bg-emerald-500/15 text-emerald-700' : status === 'rejected' ? 'bg-red-500/15 text-red-700' : 'bg-amber-500/15 text-amber-700'
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{statusLabels[status]}</span>
}

function Macro({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className={`rounded-xl border p-3 ${warn ? 'border-red-500 bg-red-500/5' : ''}`}><span className='block text-xs text-muted-foreground'>{label}/100g</span><strong className='mt-1 block'>{value}</strong></div>
}

function TagList({ title, values, danger = false }: { title: string; values: string[]; danger?: boolean }) {
  return <div><span className='text-xs text-muted-foreground'>{title}</span><div className='mt-1 flex flex-wrap gap-2'>{values.map((value) => <span key={value} className={`rounded-full px-2 py-1 text-xs ${danger ? 'bg-red-500/10 text-red-700' : 'bg-muted'}`}>{value}</span>)}</div></div>
}

function LoadingRows() { return <div className='space-y-3'>{[1, 2, 3, 4].map((value) => <div key={value} className='h-24 animate-pulse rounded-xl bg-muted' />)}</div> }
function EmptyState({ detail = false }: { detail?: boolean }) { return <div className='grid min-h-72 place-items-center text-center text-muted-foreground'><div><ShieldCheck className='mx-auto mb-3 size-8' /><p>{detail ? '选择一条候选查看详情' : '当前筛选下没有候选别名'}</p></div></div> }
function cleanNum(value: number | undefined) { return Number(value ?? 0).toFixed(1).replace(/\.0$/, '') }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString('zh-CN') : '-' }
function sourceLabel(value: string) { return ({ admin_manual: '人工创建', ai_generated: 'AI 生成', ai_semantic: '识别链路', audit_scan: '审计扫描', user_correction: '用户纠错' } as Record<string, string>)[value] ?? value }
