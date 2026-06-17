import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Button } from '@/components/ui/button'
import { adminRequest, displayApiBase } from '@/lib/api'

type ExerciseEnergyPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type ExerciseEnergyActivity = {
  id: string
  canonical_name: string
  normalized_name: string
  category: string
  intensity: string
  met_value: number
  source: string
  evidence: string
  review_status: 'pending' | 'active' | 'disabled'
  is_active: boolean
  updated_at?: string
}

type ExerciseEnergyAlias = {
  id: string
  activity_id: string
  alias_name: string
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

const categoryLabels: Record<string, string> = {
  cardio: '有氧',
  strength: '力量',
  ball: '球类',
  flexibility: '拉伸',
  daily: '日常',
  other: '其他',
}

const intensityLabels: Record<string, string> = {
  low: '低',
  moderate: '中',
  high: '高',
}

const inputClass = 'min-h-10 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30'

export function ExerciseEnergyPage({ onLogout, onMenuChange }: ExerciseEnergyPageProps) {
  const [query, setQuery] = useState('')
  const [reviewStatus, setReviewStatus] = useState('pending')
  const [active, setActive] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 40
  const [items, setItems] = useState<ExerciseEnergyActivity[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<ExerciseEnergyActivity | null>(null)
  const [aliasesText, setAliasesText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('尚未读取')

  const apiBase = displayApiBase()
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, reviewStatus, active])

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        review_status: reviewStatus,
        active,
      })
      const data = await adminRequest<ListResponse<ExerciseEnergyActivity>>(`/api/admin/exercise-energy-library?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      const nextSelected = selectedId || data.items?.[0]?.id || ''
      setSelectedId(nextSelected)
      if (nextSelected) await loadDetail(nextSelected)
      setMessage(`共 ${data.total || 0} 条，当前显示 ${(data.items || []).length} 条`)
    } catch (error) {
      const text = error instanceof Error ? error.message : '读取失败'
      setMessage(text)
      setItems([])
      setSelected(null)
      setAliasesText('')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setSelectedId(id)
    try {
      const data = await adminRequest<{ item: ExerciseEnergyActivity; aliases: ExerciseEnergyAlias[] }>(
        `/api/admin/exercise-energy-library/${encodeURIComponent(id)}`,
      )
      setSelected(data.item)
      setAliasesText((data.aliases || []).map((alias) => alias.alias_name).join('\n'))
      setItems((current) => current.map((item) => (item.id === id ? data.item : item)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '详情读取失败')
    }
  }

  async function saveSelected(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    try {
      const aliases = aliasesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const data = await adminRequest<{ item: ExerciseEnergyActivity; aliases: ExerciseEnergyAlias[] }>(
        `/api/admin/exercise-energy-library/${encodeURIComponent(selected.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...selected, aliases }),
        },
      )
      setSelected(data.item)
      setAliasesText((data.aliases || []).map((alias) => alias.alias_name).join('\n'))
      setItems((current) => current.map((item) => (item.id === data.item.id ? data.item : item)))
      toast.success('保存成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='relative z-10 flex min-h-svh gap-6 p-6'>
      <AdminSidebar activeMenu='exercise-energy' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 flex-1 space-y-6'>
        <header className='flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md'>
          <div>
            <p className='text-sm text-muted-foreground'>API：{apiBase}</p>
            <h1 className='mt-2 text-3xl font-bold tracking-tight'>运动能量库</h1>
            <p className='mt-2 text-sm text-muted-foreground'>审核长文本运动识别沉淀的 MET 标准值。</p>
          </div>
          <div className='flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-muted-foreground'>
            <Activity className='size-4' />
            {message}
          </div>
        </header>

        <section className='grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]'>
          <div className='space-y-4 rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
            <form
              className='grid gap-3'
              onSubmit={(event) => {
                event.preventDefault()
                setPage(1)
                void loadList(1)
              }}
            >
              <input
                className='h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='搜索运动名称、分类或证据'
              />
              <div className='grid grid-cols-3 gap-2'>
                <select className='h-10 rounded-md border bg-background px-2 text-sm' value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                  <option value='all'>全部状态</option>
                  <option value='pending'>待审核</option>
                  <option value='active'>已生效</option>
                  <option value='disabled'>已禁用</option>
                </select>
                <select className='h-10 rounded-md border bg-background px-2 text-sm' value={active} onChange={(event) => setActive(event.target.value)}>
                  <option value='all'>全部启用</option>
                  <option value='true'>启用</option>
                  <option value='false'>停用</option>
                </select>
                <Button type='submit' variant='outline' disabled={loading}>
                  {loading ? <Loader2 className='size-4 animate-spin' /> : '筛选'}
                </Button>
              </div>
            </form>

            <div className='max-h-[62vh] space-y-2 overflow-y-auto pr-1'>
              {items.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  onClick={() => void loadDetail(item.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selectedId === item.id ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                  }`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <span className='min-w-0 truncate text-sm font-semibold'>{item.canonical_name}</span>
                    <span className='rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground'>MET {Number(item.met_value || 0).toFixed(1)}</span>
                  </div>
                  <div className='mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                    <span>{categoryLabels[item.category] || item.category}</span>
                    <span>{intensityLabels[item.intensity] || item.intensity}</span>
                    <span>{item.review_status}</span>
                    <span>{item.is_active ? '启用' : '停用'}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className='flex items-center justify-between text-sm text-muted-foreground'>
              <Button variant='outline' disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                上一页
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button variant='outline' disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>
                下一页
              </Button>
            </div>
          </div>

          <form className='space-y-5 rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md' onSubmit={saveSelected}>
            {selected ? (
              <>
                <div className='flex items-center justify-between gap-4'>
                  <div>
                    <h2 className='text-xl font-semibold'>编辑标准运动</h2>
                    <p className='mt-1 text-xs text-muted-foreground'>{selected.id}</p>
                  </div>
                  <Button type='submit' disabled={saving}>
                    {saving ? <Loader2 className='size-4 animate-spin' /> : <Save className='size-4' />}
                    保存
                  </Button>
                </div>

                <div className='grid gap-4 md:grid-cols-2'>
                  <Field label='运动名称'>
                    <input className={inputClass} value={selected.canonical_name} onChange={(event) => setSelected({ ...selected, canonical_name: event.target.value })} />
                  </Field>
                  <Field label='MET'>
                    <input className={inputClass} type='number' step='0.1' min='0.1' max='30' value={selected.met_value} onChange={(event) => setSelected({ ...selected, met_value: Number(event.target.value) })} />
                  </Field>
                  <Field label='分类'>
                    <select className={inputClass} value={selected.category} onChange={(event) => setSelected({ ...selected, category: event.target.value })}>
                      <option value='cardio'>有氧</option>
                      <option value='strength'>力量</option>
                      <option value='ball'>球类</option>
                      <option value='flexibility'>拉伸</option>
                      <option value='daily'>日常</option>
                      <option value='other'>其他</option>
                    </select>
                  </Field>
                  <Field label='强度'>
                    <select className={inputClass} value={selected.intensity} onChange={(event) => setSelected({ ...selected, intensity: event.target.value })}>
                      <option value='low'>低</option>
                      <option value='moderate'>中</option>
                      <option value='high'>高</option>
                    </select>
                  </Field>
                  <Field label='审核状态'>
                    <select className={inputClass} value={selected.review_status} onChange={(event) => setSelected({ ...selected, review_status: event.target.value as ExerciseEnergyActivity['review_status'] })}>
                      <option value='pending'>待审核</option>
                      <option value='active'>已生效</option>
                      <option value='disabled'>已禁用</option>
                    </select>
                  </Field>
                  <Field label='是否启用'>
                    <select className={inputClass} value={selected.is_active ? 'true' : 'false'} onChange={(event) => setSelected({ ...selected, is_active: event.target.value === 'true' })}>
                      <option value='true'>启用</option>
                      <option value='false'>停用</option>
                    </select>
                  </Field>
                </div>

                <Field label='别名（每行一个）'>
                  <textarea className={`${inputClass} min-h-28`} value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} />
                </Field>
                <Field label='来源'>
                  <input className={inputClass} value={selected.source || ''} onChange={(event) => setSelected({ ...selected, source: event.target.value })} />
                </Field>
                <Field label='证据 / 审核备注'>
                  <textarea className={`${inputClass} min-h-32`} value={selected.evidence || ''} onChange={(event) => setSelected({ ...selected, evidence: event.target.value })} />
                </Field>
              </>
            ) : (
              <div className='flex min-h-[420px] items-center justify-center text-sm text-muted-foreground'>选择左侧运动后编辑</div>
            )}
          </form>
        </section>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='grid gap-2 text-sm'>
      <span className='font-medium'>{label}</span>
      {children}
    </label>
  )
}
