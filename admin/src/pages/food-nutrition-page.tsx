import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, copyText, displayApiBase } from '@/lib/api'

type FoodNutritionPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type FoodNutrition = {
  id: string
  canonical_name: string
  normalized_name?: string
  category?: string
  source?: string
  image_paths?: string[]
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  fiber_per_100g: number
  sugar_per_100g: number
  saturated_fat_per_100g: number
  cholesterol_mg_per_100g: number
  sodium_mg_per_100g: number
  potassium_mg_per_100g: number
  calcium_mg_per_100g: number
  iron_mg_per_100g: number
  magnesium_mg_per_100g: number
  zinc_mg_per_100g: number
  vitamin_a_rae_mcg_per_100g: number
  vitamin_c_mg_per_100g: number
  vitamin_d_mcg_per_100g: number
  vitamin_e_mg_per_100g: number
  vitamin_k_mcg_per_100g: number
  thiamin_mg_per_100g: number
  riboflavin_mg_per_100g: number
  niacin_mg_per_100g: number
  vitamin_b6_mg_per_100g: number
  folate_mcg_per_100g: number
  vitamin_b12_mcg_per_100g: number
  is_active: boolean
}

type ListResponse<T> = {
  items: T[]
  categories?: FoodCategory[]
  category?: string
  page: number
  limit: number
  total: number
}

type FoodCategory = {
  key: string
  label: string
}

const defaultFoodCategories: FoodCategory[] = [
  { key: 'staple', label: '主食' },
  { key: 'protein', label: '肉蛋奶' },
  { key: 'vegetable', label: '蔬菜' },
  { key: 'fruit', label: '水果' },
  { key: 'dairy', label: '乳品' },
  { key: 'beverage', label: '饮品' },
  { key: 'soup', label: '汤饮' },
  { key: 'snack', label: '零食' },
  { key: 'meal', label: '菜肴' },
  { key: 'other', label: '其他' },
]

const categoryInferenceRules: Array<{ key: string; keywords: string[] }> = [
  { key: 'soup', keywords: ['清汤', '汤', '羹', 'soup', 'broth'] },
  { key: 'beverage', keywords: ['咖啡', '拿铁', '奶茶', '茶饮', '绿茶', '红茶', '乌龙茶', '饮料', '可乐', '果汁', '豆浆', 'coffee', 'latte', 'tea', 'drink'] },
  { key: 'snack', keywords: ['坚果', '薯片', '饼干', '曲奇', '巧克力', '糖果', '糕点', '蛋糕', '零食', '瓜子', '花生', '杏仁', '核桃', 'cookie', 'snack', 'nuts'] },
  { key: 'meal', keywords: ['沙拉', '便当', '套餐', '外卖', '饭团'] },
  { key: 'staple', keywords: ['米饭', '糙米', '面条', '馒头', '包子', '粥', '燕麦', '红薯', '玉米', '土豆', '紫薯', '南瓜', '面包', '吐司', 'rice', 'noodle', 'bread', 'oat'] },
  { key: 'protein', keywords: ['鸡', '牛肉', '猪肉', '羊肉', '肉末', '肉丸', '肉片', '瘦肉', '排骨', '猪骨', '香肠', '火腿', '培根', '鱼', '虾', '蛋', '豆腐', 'protein', 'chicken', 'beef', 'egg', 'tofu', 'fish'] },
  { key: 'vegetable', keywords: ['菜', '西兰花', '生菜', '菠菜', '番茄', '黄瓜', '白菜', '秋葵', '时蔬', '蔬', 'broccoli', 'tomato', 'vegetable'] },
  { key: 'fruit', keywords: ['苹果', '香蕉', '橙', '梨', '莓', '水果', '西瓜', '草莓', 'apple', 'banana', 'berry', 'fruit'] },
  { key: 'dairy', keywords: ['酸奶', '牛奶', '奶酪', '芝士', 'cheese', 'milk', 'yogurt'] },
]

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'textarea'
  group: 'basic' | 'nutrition' | 'evidence'
  wide?: boolean
  required?: boolean
}

const fields: FieldDef[] = [
  { key: 'canonical_name', label: '标准名称', type: 'text', group: 'basic', wide: true, required: true },
  { key: 'source', label: '来源', type: 'text', group: 'basic' },
  { key: 'is_active', label: '是否启用', type: 'boolean', group: 'basic' },
  { key: 'kcal_per_100g', label: '热量 kcal/100g', type: 'number', group: 'nutrition' },
  { key: 'protein_per_100g', label: '蛋白质 g/100g', type: 'number', group: 'nutrition' },
  { key: 'carbs_per_100g', label: '碳水 g/100g', type: 'number', group: 'nutrition' },
  { key: 'fat_per_100g', label: '脂肪 g/100g', type: 'number', group: 'nutrition' },
  { key: 'fiber_per_100g', label: '膳食纤维 g/100g', type: 'number', group: 'nutrition' },
  { key: 'sugar_per_100g', label: '糖 g/100g', type: 'number', group: 'nutrition' },
  { key: 'saturated_fat_per_100g', label: '饱和脂肪 g/100g', type: 'number', group: 'nutrition' },
  { key: 'cholesterol_mg_per_100g', label: '胆固醇 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'sodium_mg_per_100g', label: '钠 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'potassium_mg_per_100g', label: '钾 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'calcium_mg_per_100g', label: '钙 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'iron_mg_per_100g', label: '铁 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'magnesium_mg_per_100g', label: '镁 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'zinc_mg_per_100g', label: '锌 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_a_rae_mcg_per_100g', label: '维A µg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_c_mg_per_100g', label: '维C mg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_d_mcg_per_100g', label: '维D µg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_e_mg_per_100g', label: '维E mg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_k_mcg_per_100g', label: '维K µg/100g', type: 'number', group: 'nutrition' },
  { key: 'thiamin_mg_per_100g', label: '维B1 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'riboflavin_mg_per_100g', label: '维B2 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'niacin_mg_per_100g', label: '烟酸 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_b6_mg_per_100g', label: '维B6 mg/100g', type: 'number', group: 'nutrition' },
  { key: 'folate_mcg_per_100g', label: '叶酸 µg/100g', type: 'number', group: 'nutrition' },
  { key: 'vitamin_b12_mcg_per_100g', label: '维B12 µg/100g', type: 'number', group: 'nutrition' },
  { key: 'image_paths', label: '图片 URL，每行一个', type: 'textarea', group: 'evidence', wide: true },
]

const blankItem: FoodNutrition = {
  id: '',
  canonical_name: '',
  source: '',
  image_paths: [],
  kcal_per_100g: 0,
  protein_per_100g: 0,
  carbs_per_100g: 0,
  fat_per_100g: 0,
  fiber_per_100g: 0,
  sugar_per_100g: 0,
  saturated_fat_per_100g: 0,
  cholesterol_mg_per_100g: 0,
  sodium_mg_per_100g: 0,
  potassium_mg_per_100g: 0,
  calcium_mg_per_100g: 0,
  iron_mg_per_100g: 0,
  magnesium_mg_per_100g: 0,
  zinc_mg_per_100g: 0,
  vitamin_a_rae_mcg_per_100g: 0,
  vitamin_c_mg_per_100g: 0,
  vitamin_d_mcg_per_100g: 0,
  vitamin_e_mg_per_100g: 0,
  vitamin_k_mcg_per_100g: 0,
  thiamin_mg_per_100g: 0,
  riboflavin_mg_per_100g: 0,
  niacin_mg_per_100g: 0,
  vitamin_b6_mg_per_100g: 0,
  folate_mcg_per_100g: 0,
  vitamin_b12_mcg_per_100g: 0,
  is_active: true,
}

function parseParamPage(value: string | null, fallback: number) {
  const n = parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 营养食物库管理页 */
export function FoodNutritionPage({ onLogout, onMenuChange }: FoodNutritionPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [active, setActive] = useState(searchParams.get('active') ?? 'all')
  const [category, setCategory] = useState(searchParams.get('category') ?? 'all')
  const [categories, setCategories] = useState<FoodCategory[]>(defaultFoodCategories)
  const [page, setPage] = useState(parseParamPage(searchParams.get('page'), 1))
  const [limit, setLimit] = useState(parseParamPage(searchParams.get('limit'), 40))
  const [items, setItems] = useState<FoodNutrition[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<FoodNutrition | null>(null)
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
  }, [page, limit, active, category, searchNonce])

  useEffect(() => {
    const params = new URLSearchParams()
    const q = query.trim()
    if (q) params.set('q', q)
    if (active !== 'all') params.set('active', active)
    if (category !== 'all') params.set('category', category)
    if (page !== 1) params.set('page', String(page))
    if (limit !== 40) params.set('limit', String(limit))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, active, category, page, limit])

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
        active,
        category,
      })
      const data = await adminRequest<ListResponse<FoodNutrition>>(`/api/admin/food-nutrition?${params.toString()}`)
      const nextItems = (data.items || []).map(withFallbackCategory)
      setItems(nextItems)
      setCategories(data.categories?.length ? data.categories : defaultFoodCategories)
      setCategory(data.category || category)
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedId((current) => current || nextItems[0]?.id || '')
      setMessage(`共 ${data.total || 0} 条，当前显示 ${nextItems.length} 条`)
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
      const data = await adminRequest<{ item: FoodNutrition }>(`/api/admin/food-nutrition/${encodeURIComponent(id)}`)
      const nextItem = withFallbackCategory(data.item)
      setSelected(nextItem)
      setItems((current) => current.map((item) => (item.id === id ? nextItem : item)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '详情读取失败')
    }
  }

  async function saveItem(id: string, payload: Record<string, string | number | boolean | string[]>) {
    setSaving(true)
    try {
      const data = await adminRequest<{ item: FoodNutrition }>(`/api/admin/food-nutrition/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const nextItem = withFallbackCategory(data.item)
      setSelected(nextItem)
      setItems((current) => current.map((item) => (item.id === id ? nextItem : item)))
      toast.success('保存成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function createItem(payload: Record<string, string | number | boolean | string[]>) {
    setCreating(true)
    try {
      const data = await adminRequest<{ item: FoodNutrition }>('/api/admin/food-nutrition', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const nextItem = withFallbackCategory(data.item)
      setItems((current) => [nextItem, ...current])
      setTotal((value) => value + 1)
      setSelectedId(nextItem.id)
      setShowCreate(false)
      toast.success('创建成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  async function deleteItem(id: string) {
    if (!window.confirm('确定要删除这条营养食物吗？删除为软删除（标记停用）。')) return
    setDeleting(true)
    try {
      await adminRequest(`/api/admin/food-nutrition/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
      <AdminSidebar activeMenu="food-nutrition" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0 space-y-6 pb-8">
        <PageHeader eyebrow="识别算法 / 营养食物库" title="营养食物库" apiBase={apiBase} />
        <section className="stats-grid">
          <Stat label="当前筛选" value={String(total)} foot="条食物" />
          <Stat label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
          <Stat
            label="当前选中"
            value={selected ? shortTitle(selected.canonical_name) : '-'}
            foot={selected?.is_active ? '启用' : '停用'}
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
              placeholder="标准名称 / 来源 / 营养字段"
            />
          </label>
          <SelectLabel
            label="分类"
            value={category}
            onChange={(value) => {
              setCategory(value)
              setPage(1)
            }}
            options={[
              ['all', '全部分类'],
              ...categories.map((item) => [item.key, item.label] as [string, string]),
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
                    categoryLabel={getCategoryLabel(categories, item.category)}
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
                categoryLabel={getCategoryLabel(categories, selected.category)}
                saving={saving}
                deleting={deleting}
                onSave={saveItem}
                onCopy={handleCopy}
                onDelete={deleteItem}
              />
            ) : (
              <Empty title="选择一条记录" desc="右侧会展示营养详情与图片。" />
            )}
          </aside>
        </section>
      </main>

      {showCreate ? (
        <CreateModal
          title="新建营养食物"
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
  categoryLabel,
  selected,
  onClick,
}: {
  item: FoodNutrition
  categoryLabel: string
  selected: boolean
  onClick: () => void
}) {
  const images = item.image_paths || []
  return (
    <article className={`sku-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="thumb-strip">
        {images.length ? (
          images.slice(0, 2).map((src) => <img key={src} src={src} alt={item.canonical_name} loading="lazy" />)
        ) : (
          <div className="no-image">缺图</div>
        )}
      </div>
      <div className="sku-body">
        <h2>{item.canonical_name || '未命名'}</h2>
        <div className="meta-row">
          <span className={`pill ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? '启用' : '停用'}</span>
          <span className="pill">{categoryLabel}</span>
          <span className="pill">{item.source || '无来源'}</span>
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

function FoodEditor({
  item,
  categoryLabel,
  saving,
  deleting,
  onSave,
  onCopy,
  onDelete,
}: {
  item: FoodNutrition
  categoryLabel: string
  saving: boolean
  deleting: boolean
  onSave: (id: string, payload: Record<string, string | number | boolean | string[]>) => Promise<void>
  onCopy: (text: string) => void
  onDelete: (id: string) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = buildPayload(form)
    void onSave(item.id, payload)
  }

  const images = item.image_paths || []

  return (
    <form onSubmit={submit}>
      <div className="editor-header">
        <div>
          <h2>{item.canonical_name || '未命名'}</h2>
          <p>分类：{categoryLabel} · {item.id}</p>
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
      <EditorSection title="每 100g 营养" item={item} group="nutrition" />
      <EditorSection title="证据" item={item} group="evidence" />
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
  onSubmit: (payload: Record<string, string | number | boolean | string[]>) => Promise<void>
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = buildPayload(form)
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
          <EditorSection title="每 100g 营养" item={blankItem} group="nutrition" />
          <EditorSection title="证据" item={blankItem} group="evidence" />
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
  item: FoodNutrition
  group: 'basic' | 'nutrition' | 'evidence'
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

function FormField({ item, field }: { item: FoodNutrition; field: FieldDef }) {
  const rawValue = item[field.key as keyof FoodNutrition]
  const value = rawValue === null || rawValue === undefined ? '' : String(rawValue)
  const id = `field-${field.key}`

  let input: React.ReactNode
  if (field.type === 'textarea') {
    input = (
      <textarea
        id={id}
        name={field.key}
        defaultValue={Array.isArray(rawValue) ? (rawValue as string[]).join('\n') : value}
        rows={4}
      />
    )
  } else if (field.type === 'boolean') {
    input = (
      <select id={id} name={field.key} defaultValue={value}>
        <option value="true">是</option>
        <option value="false">否</option>
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

function buildPayload(form: FormData) {
  const payload: Record<string, string | number | boolean | string[]> = {}
  fields.forEach((field) => {
    if (!form.has(field.key)) return
    const raw = String(form.get(field.key) ?? '').trim()
    if (field.key === 'image_paths') {
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

function getCategoryLabel(categories: FoodCategory[], key?: string): string {
  if (!key) return '其他'
  return categories.find((item) => item.key === key)?.label || key
}

function withFallbackCategory(item: FoodNutrition): FoodNutrition {
  if (item.category) return item
  return { ...item, category: inferFoodCategory(item.canonical_name) }
}

function inferFoodCategory(name: string): string {
  const normalized = name.trim().toLowerCase()
  for (const rule of categoryInferenceRules) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return rule.key
  }
  return 'other'
}
