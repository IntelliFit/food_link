import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, copyText, displayApiBase } from '@/lib/api'

type PublicFoodLibraryPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type PublicFoodItem = {
  id: string
  food_name: string
  description: string
  merchant_name: string
  merchant_address: string
  detail_address: string
  type: string
  status: string
  is_campus_food: boolean
  school_id: string
  campus_id: string
  canteen_id: string
  window_id: string
  school_name: string
  campus_name: string
  canteen_name: string
  floor: string
  window_name: string
  price: number
  price_type: string
  price_unit: string
  portion_description: string
  suitable_for_fat_loss: boolean
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  items: unknown[]
  image_paths: string[]
  user_notes: string
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type FieldType = 'text' | 'number' | 'boolean' | 'textarea' | 'select'

type FieldDef = {
  key: string
  label: string
  type: FieldType
  group: 'basic' | 'campus' | 'nutrition' | 'price' | 'evidence'
  wide?: boolean
  required?: boolean
  options?: Array<[string, string]>
}

const fields: FieldDef[] = [
  { key: 'food_name', label: '食物名称', type: 'text', group: 'basic', wide: true, required: true },
  { key: 'type', label: '类型', type: 'select', group: 'basic', options: [['common', 'common'], ['campus', 'campus'], ['merchant', 'merchant']] },
  { key: 'status', label: '状态', type: 'select', group: 'basic', options: [['published', 'published'], ['deleted', 'deleted'], ['pending', 'pending'], ['rejected', 'rejected']] },
  { key: 'is_campus_food', label: '校园食物', type: 'boolean', group: 'basic' },
  { key: 'description', label: '描述', type: 'textarea', group: 'basic', wide: true },
  { key: 'merchant_name', label: '商家名称', type: 'text', group: 'basic' },
  { key: 'merchant_address', label: '商家地址', type: 'text', group: 'basic', wide: true },
  { key: 'detail_address', label: '详细地址', type: 'text', group: 'basic', wide: true },
  { key: 'school_id', label: '学校 ID', type: 'text', group: 'campus' },
  { key: 'campus_id', label: '校区 ID', type: 'text', group: 'campus' },
  { key: 'canteen_id', label: '食堂 ID', type: 'text', group: 'campus' },
  { key: 'window_id', label: '窗口 ID', type: 'text', group: 'campus' },
  { key: 'school_name', label: '学校', type: 'text', group: 'campus' },
  { key: 'campus_name', label: '校区', type: 'text', group: 'campus' },
  { key: 'canteen_name', label: '食堂', type: 'text', group: 'campus' },
  { key: 'floor', label: '楼层', type: 'text', group: 'campus' },
  { key: 'window_name', label: '窗口', type: 'text', group: 'campus' },
  { key: 'total_calories', label: '总热量 kcal', type: 'number', group: 'nutrition' },
  { key: 'total_protein', label: '总蛋白质 g', type: 'number', group: 'nutrition' },
  { key: 'total_carbs', label: '总碳水 g', type: 'number', group: 'nutrition' },
  { key: 'total_fat', label: '总脂肪 g', type: 'number', group: 'nutrition' },
  { key: 'price', label: '价格', type: 'number', group: 'price' },
  { key: 'price_type', label: '价格类型', type: 'text', group: 'price' },
  { key: 'price_unit', label: '价格单位', type: 'text', group: 'price' },
  { key: 'portion_description', label: '份量说明', type: 'text', group: 'price', wide: true },
  { key: 'suitable_for_fat_loss', label: '减脂友好', type: 'boolean', group: 'price' },
  { key: 'items', label: '子项 JSON', type: 'textarea', group: 'evidence', wide: true },
  { key: 'image_paths', label: '图片 URL，每行一个', type: 'textarea', group: 'evidence', wide: true },
  { key: 'user_notes', label: '备注', type: 'textarea', group: 'evidence', wide: true },
]

const blankItem: PublicFoodItem = {
  id: '',
  food_name: '',
  description: '',
  merchant_name: '',
  merchant_address: '',
  detail_address: '',
  type: 'common',
  status: 'published',
  is_campus_food: false,
  school_id: '',
  campus_id: '',
  canteen_id: '',
  window_id: '',
  school_name: '',
  campus_name: '',
  canteen_name: '',
  floor: '',
  window_name: '',
  price: 0,
  price_type: '',
  price_unit: '',
  portion_description: '',
  suitable_for_fat_loss: false,
  total_calories: 0,
  total_protein: 0,
  total_carbs: 0,
  total_fat: 0,
  items: [],
  image_paths: [],
  user_notes: '',
}

function parseParamPage(value: string | null, fallback: number) {
  const n = parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 公共食物库管理页 */
export function PublicFoodLibraryPage({ onLogout, onMenuChange }: PublicFoodLibraryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [isCampusFood, setIsCampusFood] = useState(searchParams.get('is_campus_food') ?? 'all')
  const [type, setType] = useState(searchParams.get('type') ?? 'all')
  const [page, setPage] = useState(parseParamPage(searchParams.get('page'), 1))
  const [limit, setLimit] = useState(parseParamPage(searchParams.get('limit'), 40))
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<PublicFoodItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const [message, setMessage] = useState('尚未读取')

  const apiBase = displayApiBase()
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, status, isCampusFood, type, searchNonce])

  useEffect(() => {
    const params = new URLSearchParams()
    const q = query.trim()
    if (q) params.set('q', q)
    if (status !== 'all') params.set('status', status)
    if (isCampusFood !== 'all') params.set('is_campus_food', isCampusFood)
    if (type !== 'all') params.set('type', type)
    if (page !== 1) params.set('page', String(page))
    if (limit !== 40) params.set('limit', String(limit))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, isCampusFood, type, page, limit])

  useEffect(() => {
    if (!selectedId) {
      setSelected(items[0] || null)
      return
    }
    const found = items.find((item) => item.id === selectedId)
    if (found) setSelected(found)
  }, [items, selectedId])

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        status,
        is_campus_food: isCampusFood,
        type,
      })
      const data = await adminRequest<ListResponse<PublicFoodItem>>(`/api/admin/public-food-library?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedId((current) => current || data.items?.[0]?.id || '')
      setMessage(`共 ${data.total || 0} 条，当前显示 ${(data.items || []).length} 条`)
    } catch (error) {
      const text = error instanceof Error ? error.message : '读取失败'
      setMessage(text)
      setItems([])
      setSelected(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setSelectedId(id)
    try {
      const data = await adminRequest<{ item: PublicFoodItem }>(`/api/admin/public-food-library/${encodeURIComponent(id)}`)
      setSelected(data.item)
      setItems((current) => current.map((item) => (item.id === id ? data.item : item)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '详情读取失败')
    }
  }

  async function saveItem(id: string, payload: Record<string, unknown>) {
    setSaving(true)
    try {
      const data = await adminRequest<{ item: PublicFoodItem }>(`/api/admin/public-food-library/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setSelected(data.item)
      setItems((current) => current.map((item) => (item.id === id ? data.item : item)))
      toast.success('保存成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function createItem(payload: Record<string, unknown>) {
    setCreating(true)
    try {
      const data = await adminRequest<{ item: PublicFoodItem }>('/api/admin/public-food-library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setItems((current) => [data.item, ...current])
      setTotal((value) => value + 1)
      setSelectedId(data.item.id)
      setShowCreate(false)
      toast.success('创建成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  async function deleteItem(id: string) {
    if (!window.confirm('确定要删除这条公共食物吗？删除为软删除（状态设为 deleted）。')) return
    setDeleting(true)
    try {
      await adminRequest(`/api/admin/public-food-library/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item.id !== id))
      setTotal((value) => Math.max(0, value - 1))
      if (selected?.id === id) {
        setSelected(null)
        setSelectedId('')
      }
      toast.success('删除成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  async function handleCopy(text: string) {
    try {
      await copyText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }

  function runSearch() {
    setPage(1)
    setSearchNonce((n) => n + 1)
  }

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="public-food-library" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0 space-y-6 pb-8">
        <PageHeader eyebrow="UGC / 公共食物库" title="公共食物库" apiBase={apiBase} />
        <section className="stats-grid">
          <Stat label="当前筛选" value={String(total)} foot="条食物" />
          <Stat label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
          <Stat
            label="当前选中"
            value={selected ? shortTitle(selected.food_name) : '-'}
            foot={selected?.status || '无'}
          />
        </section>
        <section className="toolbar packaged-toolbar">
          <label className="wide">
            搜索
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runSearch()
              }}
              placeholder="食物名 / 商家 / 地址 / 校区"
            />
          </label>
          <SelectLabel
            label="状态"
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={[
              ['all', '全部'],
              ['published', '已发布'],
              ['deleted', '已删除'],
              ['pending', '待审'],
              ['rejected', '已拒绝'],
            ]}
          />
          <SelectLabel
            label="校园"
            value={isCampusFood}
            onChange={(value) => {
              setIsCampusFood(value)
              setPage(1)
            }}
            options={[
              ['all', '全部'],
              ['true', '是'],
              ['false', '否'],
            ]}
          />
          <SelectLabel
            label="类型"
            value={type}
            onChange={(value) => {
              setType(value)
              setPage(1)
            }}
            options={[
              ['all', '全部'],
              ['common', 'common'],
              ['campus', 'campus'],
              ['merchant', 'merchant'],
            ]}
          />
          <SelectLabel
            label="每页"
            value={String(limit)}
            onChange={(value) => {
              setLimit(Number(value))
              setPage(1)
            }}
            options={[
              ['20', '20'],
              ['40', '40'],
              ['60', '60'],
              ['100', '100'],
            ]}
          />
          <button type="button" onClick={() => setShowCreate(true)}>
            新建
          </button>
          <button className="primary" type="button" onClick={runSearch}>
            刷新
          </button>
        </section>
        <StatusLine message={message} page={page} totalPages={totalPages} setPage={setPage} />
        <section className="workspace packaged-workspace">
          <div className="sku-list">
            {loading ? <SkeletonRows /> : null}
            {!loading && items.length === 0 ? <Empty title="没有食物" desc="换个关键词或筛选条件再试。" /> : null}
            {!loading
              ? items.map((item) => (
                  <FoodCard
                    key={item.id}
                    item={item}
                    selected={item.id === selected?.id}
                    onClick={() => void loadDetail(item.id)}
                  />
                ))
              : null}
          </div>
          <aside className="detail-panel sku-editor-panel">
            {selected ? (
              <FoodEditor
                key={selected.id}
                item={selected}
                saving={saving}
                deleting={deleting}
                onSave={saveItem}
                onCopy={handleCopy}
                onDelete={deleteItem}
              />
            ) : (
              <Empty title="选择一条记录" desc="右侧会展示详情、价格、营养和子项。" />
            )}
          </aside>
        </section>
      </main>

      {showCreate ? (
        <CreateModal
          title="新建公共食物"
          creating={creating}
          onClose={() => setShowCreate(false)}
          onSubmit={createItem}
        />
      ) : null}
    </div>
  )
}

function PageHeader({ eyebrow, title, apiBase }: { eyebrow: string; title: string; apiBase: string }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="api-pill">API: {apiBase}</div>
    </header>
  )
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="stat-foot">{foot}</span>
    </article>
  )
}

function SelectLabel({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusLine({
  message,
  page,
  totalPages,
  setPage,
}: {
  message: string
  page: number
  totalPages: number
  setPage: (value: number | ((current: number) => number)) => void
}) {
  return (
    <section className="statusline">
      <span>{message}</span>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
          上一页
        </button>
        <span>
          第 {page} / {totalPages} 页
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
          下一页
        </button>
      </div>
    </section>
  )
}

function Empty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <h2>{title}</h2>
      <p>{desc}</p>
    </div>
  )
}

function Spinner({ small = false }: { small?: boolean }) {
  return <span className={`spinner ${small ? 'small' : ''}`} />
}

function SkeletonRows() {
  return (
    <>
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </>
  )
}

function FoodCard({
  item,
  selected,
  onClick,
}: {
  item: PublicFoodItem
  selected: boolean
  onClick: () => void
}) {
  const images = item.image_paths || []
  return (
    <article className={`sku-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="thumb-strip">
        {images.length ? (
          images.slice(0, 2).map((src) => <img key={src} src={src} alt={item.food_name} loading="lazy" />)
        ) : (
          <div className="no-image">缺图</div>
        )}
      </div>
      <div className="sku-body">
        <h2>{item.food_name || '未命名'}</h2>
        <div className="meta-row">
          <span className={`pill ${item.status === 'published' ? 'active' : 'inactive'}`}>{item.status || '无状态'}</span>
          <span className="pill">{item.type || '无类型'}</span>
          <span className="pill">{item.is_campus_food ? '校园' : '非校园'}</span>
          <span className="pill">{images.length} 图</span>
        </div>
        <div className="nutrition-line">
          <span>
            <strong>{cleanNum(item.total_calories)}</strong>kcal
          </span>
          <span>
            <strong>{cleanNum(item.total_protein)}</strong>蛋白
          </span>
          <span>
            <strong>{cleanNum(item.total_carbs)}</strong>碳水
          </span>
          <span>
            <strong>{cleanNum(item.total_fat)}</strong>脂肪
          </span>
        </div>
      </div>
    </article>
  )
}

function FoodEditor({
  item,
  saving,
  deleting,
  onSave,
  onCopy,
  onDelete,
}: {
  item: PublicFoodItem
  saving: boolean
  deleting: boolean
  onSave: (id: string, payload: Record<string, unknown>) => Promise<void>
  onCopy: (text: string) => void
  onDelete: (id: string) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildPayload(event.currentTarget)
    if (!payload) return
    void onSave(item.id, payload)
  }

  const images = item.image_paths || []

  return (
    <form onSubmit={submit}>
      <div className="editor-header">
        <div>
          <h2>{item.food_name || '未命名'}</h2>
          <p>{item.id}</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" onClick={() => onCopy(item.id)}>
            复制 ID
          </button>
          <button type="button" className="destructive" onClick={() => onDelete(item.id)} disabled={deleting}>
            {deleting ? <Spinner small /> : '删除'}
          </button>
        </div>
      </div>
      <section className="detail-section">
        <h3>图片</h3>
        <div className="image-list">
          {images.length ? (
            images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="食物图片" loading="lazy" />
              </a>
            ))
          ) : (
            <p className="muted">这条记录没有图片。</p>
          )}
        </div>
      </section>
      <EditorSection title="基本信息" item={item} group="basic" />
      <EditorSection title="校园信息" item={item} group="campus" />
      <EditorSection title="总营养" item={item} group="nutrition" />
      <EditorSection title="价格与份量" item={item} group="price" />
      <EditorSection title="证据与备注" item={item} group="evidence" />
      <div className="actions">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? <Spinner small /> : '保存修改'}
        </button>
      </div>
    </form>
  )
}

function CreateModal({
  title,
  creating,
  onClose,
  onSubmit,
}: {
  title: string
  creating: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildPayload(event.currentTarget)
    if (!payload) return
    void onSubmit(payload)
  }

  return (
    <div className="modal-overlay" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="modal-panel">
        <div className="editor-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <form onSubmit={submit}>
          <EditorSection title="基本信息" item={blankItem} group="basic" />
          <EditorSection title="校园信息" item={blankItem} group="campus" />
          <EditorSection title="总营养" item={blankItem} group="nutrition" />
          <EditorSection title="价格与份量" item={blankItem} group="price" />
          <EditorSection title="证据与备注" item={blankItem} group="evidence" />
          <div className="actions">
            <button type="button" onClick={onClose}>取消</button>
            <button className="primary" type="submit" disabled={creating}>
              {creating ? <Spinner small /> : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditorSection({
  title,
  item,
  group,
}: {
  title: string
  item: PublicFoodItem
  group: FieldDef['group']
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <div className="form-grid">
        {fields
          .filter((field) => field.group === group)
          .map((field) => (
            <FormField key={field.key} item={item} field={field} />
          ))}
      </div>
    </section>
  )
}

function FormField({ item, field }: { item: PublicFoodItem; field: FieldDef }) {
  const rawValue = item[field.key as keyof PublicFoodItem]
  const value = rawValue === null || rawValue === undefined ? '' : String(rawValue)
  const id = `field-${field.key}`

  let input: React.ReactNode
  if (field.type === 'textarea') {
    let defaultValue = ''
    if (field.key === 'items') {
      defaultValue = Array.isArray(rawValue) ? JSON.stringify(rawValue, null, 2) : ''
    } else if (Array.isArray(rawValue)) {
      defaultValue = (rawValue as string[]).join('\n')
    } else {
      defaultValue = value
    }
    input = <textarea id={id} name={field.key} defaultValue={defaultValue} rows={field.key === 'items' ? 8 : 4} />
  } else if (field.type === 'boolean') {
    input = (
      <select id={id} name={field.key} defaultValue={value}>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    )
  } else if (field.type === 'select') {
    input = (
      <select id={id} name={field.key} defaultValue={value}>
        {(field.options || []).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    )
  } else {
    input = <input id={id} name={field.key} type={field.type === 'number' ? 'number' : 'text'} defaultValue={value} />
  }

  return (
    <div className={`form-field ${field.wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{field.label}</label>
      {input}
    </div>
  )
}

function buildPayload(form: HTMLFormElement): Record<string, unknown> | null {
  const data = new FormData(form)
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    if (!data.has(field.key)) continue
    const raw = String(data.get(field.key) ?? '').trim()
    if (field.key === 'image_paths') {
      payload[field.key] = raw
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
    } else if (field.key === 'items') {
      if (!raw) {
        payload[field.key] = []
      } else {
        try {
          payload[field.key] = JSON.parse(raw)
        } catch {
          toast.error('子项 JSON 格式错误')
          return null
        }
      }
    } else if (field.type === 'number') {
      payload[field.key] = raw === '' ? 0 : Number(raw)
    } else if (field.type === 'boolean') {
      payload[field.key] = raw === 'true'
    } else {
      payload[field.key] = raw
    }
  }
  return payload
}

function shortTitle(value: string): string {
  if (!value) return '-'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

function cleanNum(value: number | undefined): string {
  if (value === undefined || value === null) return '-'
  return Number(value).toFixed(1).replace(/\.0$/, '')
}
