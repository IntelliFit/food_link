import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, copyText, displayApiBase } from '@/lib/api'

type PackagedFoodsPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type PackagedFood = {
  id: string
  brand: string
  product_name: string
  display_name: string
  normalized_name?: string
  product_key?: string
  search_text?: string
  product_family_key?: string
  spec_text?: string
  barcode?: string
  flavor_text?: string
  package_category?: string
  ingredients_text?: string
  source_image_urls?: string[]
  ocr_raw_text?: string
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  conversion_status?: string
  ingest_method?: string
  net_content_value?: number
  net_content_unit?: string
  unit_count?: number
  unit_content_value?: number
  unit_content_unit?: string
  review_status?: string
  net_weight_g: number
  serving_weight_g: number
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  fiber_per_100g: number
  sugar_per_100g: number
  sodium_mg_per_100g: number
  source_url?: string
  source?: string
  is_active: boolean
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type PackagedFieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea'
  group: 'basic' | 'nutrition' | 'evidence'
  wide?: boolean
}

const packagedFields: PackagedFieldDef[] = [
  { key: 'brand', label: '品牌', type: 'text', group: 'basic' },
  { key: 'product_name', label: '商品名', type: 'text', group: 'basic' },
  { key: 'display_name', label: '展示名', type: 'text', group: 'basic', wide: true },
  { key: 'flavor_text', label: '口味', type: 'text', group: 'basic' },
  { key: 'spec_text', label: '规格说明', type: 'text', group: 'basic', wide: true },
  { key: 'barcode', label: '条码', type: 'text', group: 'basic' },
  { key: 'package_category', label: '分类', type: 'text', group: 'basic' },
  { key: 'review_status', label: '审核状态', type: 'select', group: 'basic' },
  { key: 'is_active', label: '是否启用', type: 'boolean', group: 'basic' },
  { key: 'net_weight_g', label: '净重 g', type: 'number', group: 'basic' },
  { key: 'net_content_value', label: '净含量数值', type: 'number', group: 'basic' },
  { key: 'net_content_unit', label: '净含量单位', type: 'text', group: 'basic' },
  { key: 'unit_count', label: '内含数量', type: 'number', group: 'basic' },
  { key: 'unit_content_value', label: '单份规格', type: 'number', group: 'basic' },
  { key: 'unit_content_unit', label: '单份单位', type: 'text', group: 'basic' },
  { key: 'kcal_per_100g', label: '热量 kcal/100g', type: 'number', group: 'nutrition' },
  { key: 'protein_per_100g', label: '蛋白质 g/100g', type: 'number', group: 'nutrition' },
  { key: 'carbs_per_100g', label: '碳水 g/100g', type: 'number', group: 'nutrition' },
  { key: 'fat_per_100g', label: '脂肪 g/100g', type: 'number', group: 'nutrition' },
  { key: 'fiber_per_100g', label: '膳食纤维 g/100g', type: 'number', group: 'nutrition' },
  { key: 'sugar_per_100g', label: '糖 g/100g', type: 'number', group: 'nutrition' },
  { key: 'sodium_mg_per_100g', label: '钠 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'ingredients_text', label: '配料', type: 'textarea', group: 'evidence', wide: true },
  { key: 'source_image_urls', label: '图片 URL，每行一个', type: 'textarea', group: 'evidence', wide: true },
  { key: 'ocr_raw_text', label: 'OCR 原文', type: 'textarea', group: 'evidence', wide: true },
  { key: 'search_text', label: '搜索文本', type: 'textarea', group: 'evidence', wide: true },
]

/** 包装食品库管理页：完全复用主分支历史代码逻辑 */
export function PackagedFoodsPage({ onLogout, onMenuChange }: PackagedFoodsPageProps) {
  const [query, setQuery] = useState('')
  const [reviewStatus, setReviewStatus] = useState('all')
  const [active, setActive] = useState('all')
  const [imageState, setImageState] = useState('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(40)
  const [items, setItems] = useState<PackagedFood[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<PackagedFood | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('尚未读取')

  const apiBase = displayApiBase()
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, reviewStatus, active, imageState])

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
        review_status: reviewStatus,
        active,
        image_state: imageState,
      })
      const data = await adminRequest<ListResponse<PackagedFood>>(`/api/admin/packaged-foods?${params.toString()}`)
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
      const data = await adminRequest<{ item: PackagedFood }>(`/api/admin/packaged-foods/${encodeURIComponent(id)}`)
      setSelected(data.item)
      setItems((current) => current.map((item) => (item.id === id ? data.item : item)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '详情读取失败')
    }
  }

  async function saveItem(id: string, payload: Record<string, string | number | boolean | string[]>) {
    setSaving(true)
    try {
      const data = await adminRequest<{ item: PackagedFood }>(`/api/admin/packaged-foods/${encodeURIComponent(id)}`, {
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
    void loadList(1)
  }

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="packaged-foods" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0 space-y-6 pb-8">
        <PageHeader eyebrow="零食 SKU / 包装食品库" title="包装食品库" apiBase={apiBase} />
        <section className="stats-grid">
          <Stat label="当前筛选" value={String(total)} foot="条 SKU" />
          <Stat label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
          <Stat
            label="当前选中"
            value={selected ? shortTitle(selected.display_name || selected.product_name) : '-'}
            foot={selected?.review_status || '无'}
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
              placeholder="品牌 / 商品名 / 条码 / OCR / 搜索文本"
            />
          </label>
          <SelectLabel
            label="审核"
            value={reviewStatus}
            onChange={(value) => {
              setReviewStatus(value)
              setPage(1)
            }}
            options={[
              ['all', '全部状态'],
              ['active', 'active'],
              ['pending', 'pending'],
              ['web_verified', 'web_verified'],
              ['rejected', 'rejected'],
              ['inactive', 'inactive'],
              ['blank', '空状态'],
            ]}
          />
          <SelectLabel
            label="启用"
            value={active}
            onChange={(value) => {
              setActive(value)
              setPage(1)
            }}
            options={[
              ['all', '全部'],
              ['true', '启用'],
              ['false', '停用'],
            ]}
          />
          <SelectLabel
            label="图片"
            value={imageState}
            onChange={(value) => {
              setImageState(value)
              setPage(1)
            }}
            options={[
              ['all', '全部'],
              ['with_images', '有图'],
              ['missing_images', '缺图'],
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
          <button className="primary" type="button" onClick={runSearch}>
            刷新
          </button>
        </section>
        <StatusLine message={message} page={page} totalPages={totalPages} setPage={setPage} />
        <section className="workspace packaged-workspace">
          <div className="sku-list">
            {loading ? <SkeletonRows /> : null}
            {!loading && items.length === 0 ? <Empty title="没有 SKU" desc="换个关键词或筛选条件再试。" /> : null}
            {!loading
              ? items.map((item) => (
                  <PackagedFoodCard
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
              <PackagedFoodEditor
                key={selected.id}
                item={selected}
                saving={saving}
                onSave={saveItem}
                onCopy={handleCopy}
              />
            ) : (
              <Empty title="选择一条 SKU" desc="右侧会展示图片、规格、核心营养、OCR 和搜索字段。" />
            )}
          </aside>
        </section>
      </main>
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

function PackagedFoodCard({
  item,
  selected,
  onClick,
}: {
  item: PackagedFood
  selected: boolean
  onClick: () => void
}) {
  const images = item.source_image_urls || []
  return (
    <article className={`sku-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="thumb-strip">
        {images.length ? (
          images.slice(0, 2).map((src) => <img key={src} src={src} alt={item.display_name || item.product_name} loading="lazy" />)
        ) : (
          <div className="no-image">缺图</div>
        )}
      </div>
      <div className="sku-body">
        <h2>{item.display_name || item.product_name || '未命名'}</h2>
        <div className="meta-row">
          <span className={`pill ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? '启用' : '停用'}</span>
          <span className="pill">{item.review_status || '空状态'}</span>
          <span className="pill">{displaySpec(item)}</span>
          <span className="pill">{images.length} 图</span>
        </div>
        <div className="nutrition-line">
          <span>
            <strong>{cleanNum(item.kcal_per_100g)}</strong>kcal
          </span>
          <span>
            <strong>{cleanNum(item.protein_per_100g)}</strong>蛋白
          </span>
          <span>
            <strong>{cleanNum(item.carbs_per_100g)}</strong>碳水
          </span>
          <span>
            <strong>{cleanNum(item.fat_per_100g)}</strong>脂肪
          </span>
        </div>
      </div>
    </article>
  )
}

function PackagedFoodEditor({
  item,
  saving,
  onSave,
  onCopy,
}: {
  item: PackagedFood
  saving: boolean
  onSave: (id: string, payload: Record<string, string | number | boolean | string[]>) => Promise<void>
  onCopy: (text: string) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload: Record<string, string | number | boolean | string[]> = {}
    packagedFields.forEach((field) => {
      if (!form.has(field.key)) return
      const raw = String(form.get(field.key) ?? '').trim()
      if (field.key === 'source_image_urls') {
        payload[field.key] = raw
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
      } else if (field.type === 'number') {
        payload[field.key] = raw === '' ? 0 : Number(raw)
      } else if (field.type === 'boolean') {
        payload[field.key] = raw === 'true'
      } else {
        payload[field.key] = raw
      }
    })
    void onSave(item.id, payload)
  }

  const images = item.source_image_urls || []

  return (
    <form onSubmit={submit}>
      <div className="editor-header">
        <div>
          <h2>{item.display_name || item.product_name || '未命名'}</h2>
          <p>{item.id}</p>
        </div>
        <button type="button" onClick={() => onCopy(item.id)}>
          复制 ID
        </button>
      </div>
      <section className="detail-section">
        <h3>图片</h3>
        <div className="image-list">
          {images.length ? (
            images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="商品图片" loading="lazy" />
              </a>
            ))
          ) : (
            <p className="muted">这条记录没有图片。</p>
          )}
        </div>
      </section>
      <EditorSection title="商品与规格" item={item} group="basic" />
      <EditorSection title="核心营养" item={item} group="nutrition" />
      <EditorSection title="证据与搜索" item={item} group="evidence" />
      <div className="actions">
        <button type="button" onClick={() => onCopy(item.product_key || '')} disabled={!item.product_key}>
          复制 product_key
        </button>
        <button className="primary" type="submit" disabled={saving}>
          {saving ? <Spinner small /> : '保存修改'}
        </button>
      </div>
    </form>
  )
}

function EditorSection({
  title,
  item,
  group,
}: {
  title: string
  item: PackagedFood
  group: 'basic' | 'nutrition' | 'evidence'
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <div className="form-grid">
        {packagedFields
          .filter((field) => field.group === group)
          .map((field) => (
            <PackagedField key={field.key} item={item} field={field} />
          ))}
      </div>
    </section>
  )
}

function PackagedField({
  item,
  field,
}: {
  item: PackagedFood
  field: PackagedFieldDef
}) {
  const rawValue = getPackagedValue(item, field.key)
  const value = rawValue === null || rawValue === undefined ? '' : String(rawValue)
  const id = `field-${field.key}`

  let input: React.ReactNode
  if (field.type === 'textarea') {
    input = <textarea id={id} name={field.key} defaultValue={value} rows={4} />
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
        <option value="">空</option>
        <option value="active">active</option>
        <option value="pending">pending</option>
        <option value="web_verified">web_verified</option>
        <option value="rejected">rejected</option>
        <option value="inactive">inactive</option>
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

function getPackagedValue(
  item: PackagedFood,
  key: PackagedFieldDef['key'],
): string | number | boolean | string[] | undefined {
  return item[key as keyof PackagedFood] as string | number | boolean | string[] | undefined
}

function shortTitle(value: string): string {
  if (!value) return '-'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

function cleanNum(value: number | undefined): string {
  if (value === undefined || value === null) return '-'
  return Number(value).toFixed(1).replace(/\.0$/, '')
}

function displaySpec(item: PackagedFood): string {
  if (item.net_content_value && item.net_content_unit) return `${item.net_content_value}${item.net_content_unit}`
  if (item.net_weight_g) return `${item.net_weight_g}g`
  if (item.spec_text) return item.spec_text
  return '无规格'
}
