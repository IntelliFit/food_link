import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, displayApiBase } from '@/lib/api'
import { Search, Play, Save, RefreshCw, ImageOff } from 'lucide-react'

type PackagedFood = {
  id: string
  brand: string
  product_name: string
  display_name: string
  net_weight_g: number
  net_content_value?: number
  net_content_unit?: string
  kcal_per_100g: number
  protein_per_100g?: number
  carbs_per_100g?: number
  fat_per_100g?: number
  source_image_urls?: string[]
  review_status?: string
  is_active: boolean
}

type PackagedFoodDetail = PackagedFood & {
  normalized_name?: string
  product_key?: string
  search_text?: string
  product_family_key?: string
  flavor_text?: string
  spec_text?: string
  barcode?: string
  package_category?: string
  ingredients_text?: string
  ocr_raw_text?: string
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  conversion_status?: string
  extract_confidence?: number
  raw_label_payload?: Record<string, any>
  field_confidence?: Record<string, any>
  ingest_method?: string
  unit_count?: number
  unit_content_value?: number
  unit_content_unit?: string
  serving_weight_g?: number
  source_url?: string
  source?: string
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
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type ExtractResult = {
  brand?: string
  product_name?: string
  display_name?: string
  flavor_text?: string
  spec_text?: string
  barcode?: string
  package_category?: string
  ingredients_text?: string
  net_content_value?: number
  net_content_unit?: string
  unit_count?: number
  unit_content_value?: number
  unit_content_unit?: string
  net_weight_g?: number
  serving_weight_g?: number
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  conversion_status?: string
  extract_confidence?: number
  ocr_raw_text?: string
  review_status?: string
  is_active?: boolean
  search_text?: string
  unit_nutrition_per_100g?: Record<string, number>
  raw_label_payload?: Record<string, any>
  field_confidence?: Record<string, any>
  auto_ingest_result?: {
    status?: string
    reason?: string
    missing_fields?: string[]
    conflict_reasons?: string[]
  }
}

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea'
  group: 'basic' | 'nutrition' | 'evidence'
  path: string
  wide?: boolean
  options?: Array<[string, string]>
}

type PackagedFoodTestPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

const BASIC_FIELDS: FieldDef[] = [
  { key: 'brand', label: '品牌', type: 'text', group: 'basic', path: 'brand' },
  { key: 'product_name', label: '商品名', type: 'text', group: 'basic', path: 'product_name' },
  { key: 'display_name', label: '展示名', type: 'text', group: 'basic', path: 'display_name', wide: true },
  { key: 'flavor_text', label: '口味', type: 'text', group: 'basic', path: 'flavor_text' },
  { key: 'spec_text', label: '规格说明', type: 'text', group: 'basic', path: 'spec_text', wide: true },
  { key: 'barcode', label: '条码', type: 'text', group: 'basic', path: 'barcode' },
  { key: 'package_category', label: '分类', type: 'text', group: 'basic', path: 'package_category' },
  {
    key: 'review_status',
    label: '审核状态',
    type: 'select',
    group: 'basic',
    path: 'review_status',
    options: [
      ['', '空'],
      ['active', 'active'],
      ['pending', 'pending'],
      ['web_verified', 'web_verified'],
      ['rejected', 'rejected'],
      ['inactive', 'inactive'],
    ],
  },
  {
    key: 'is_active',
    label: '是否启用',
    type: 'boolean',
    group: 'basic',
    path: 'is_active',
  },
  { key: 'net_content_value', label: '净含量数值', type: 'number', group: 'basic', path: 'net_content_value' },
  { key: 'net_content_unit', label: '净含量单位', type: 'text', group: 'basic', path: 'net_content_unit' },
  { key: 'net_weight_g', label: '净重 g', type: 'number', group: 'basic', path: 'net_weight_g' },
  { key: 'serving_weight_g', label: '每份重量 g', type: 'number', group: 'basic', path: 'serving_weight_g' },
  { key: 'unit_count', label: '内含数量', type: 'number', group: 'basic', path: 'unit_count' },
  { key: 'unit_content_value', label: '单份规格', type: 'number', group: 'basic', path: 'unit_content_value' },
  { key: 'unit_content_unit', label: '单份单位', type: 'text', group: 'basic', path: 'unit_content_unit' },
  { key: 'nutrition_basis_unit', label: '营养口径', type: 'text', group: 'basic', path: 'nutrition_basis_unit' },
  { key: 'energy_unit_raw', label: '能量单位原文', type: 'text', group: 'basic', path: 'energy_unit_raw' },
  { key: 'conversion_status', label: '转换状态', type: 'text', group: 'basic', path: 'conversion_status' },
]

const NUTRIENT_FIELDS: { key: string; label: string; precision: number; unit: string }[] = [
  { key: 'calories', label: '热量', precision: 1, unit: 'kcal' },
  { key: 'protein', label: '蛋白质', precision: 1, unit: 'g' },
  { key: 'carbs', label: '碳水', precision: 1, unit: 'g' },
  { key: 'fat', label: '脂肪', precision: 1, unit: 'g' },
  { key: 'fiber', label: '膳食纤维', precision: 1, unit: 'g' },
  { key: 'sugar', label: '糖', precision: 1, unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', precision: 1, unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', precision: 0, unit: 'mg' },
  { key: 'sodiumMg', label: '钠', precision: 0, unit: 'mg' },
  { key: 'potassiumMg', label: '钾', precision: 0, unit: 'mg' },
  { key: 'calciumMg', label: '钙', precision: 0, unit: 'mg' },
  { key: 'ironMg', label: '铁', precision: 0, unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', precision: 0, unit: 'mg' },
  { key: 'zincMg', label: '锌', precision: 0, unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', precision: 2, unit: 'μg RAE' },
  { key: 'vitaminCMg', label: '维生素C', precision: 2, unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', precision: 2, unit: 'μg' },
  { key: 'vitaminEMg', label: '维生素E', precision: 2, unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', precision: 2, unit: 'μg' },
  { key: 'thiaminMg', label: '维生素B1', precision: 2, unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', precision: 2, unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', precision: 2, unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', precision: 2, unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', precision: 2, unit: 'μg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', precision: 2, unit: 'μg' },
]

const EVIDENCE_FIELDS: FieldDef[] = [
  { key: 'ingredients_text', label: '配料', type: 'textarea', group: 'evidence', path: 'ingredients_text', wide: true },
  { key: 'ocr_raw_text', label: 'OCR 原文', type: 'textarea', group: 'evidence', path: 'ocr_raw_text', wide: true },
  { key: 'search_text', label: '搜索文本', type: 'textarea', group: 'evidence', path: 'search_text', wide: true },
]

function parseParamPage(value: string | null, fallback: number) {
  const n = parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function PackagedFoodTestPage({ onLogout, onMenuChange }: PackagedFoodTestPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [items, setItems] = useState<PackagedFood[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(parseParamPage(searchParams.get('page'), 1))
  const [limit] = useState(40)
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<PackagedFoodDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [edited, setEdited] = useState<ExtractResult | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [message, setMessage] = useState('尚未读取')

  const apiBase = displayApiBase()
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (page !== 1) params.set('page', String(page))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page])

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId)
    } else {
      setDetail(null)
      setEdited(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function loadList(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        review_status: 'all',
        active: 'all',
        image_state: 'all',
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
      setSelectedId('')
      setDetail(null)
      setEdited(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true)
    try {
      const data = await adminRequest<{ item: PackagedFoodDetail }>(`/api/admin/packaged-foods/${encodeURIComponent(id)}`)
      const food = data.item
      setDetail(food)
      setEdited(foodToEditable(food))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载详情失败')
      setDetail(null)
      setEdited(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const navigate = useNavigate()

  function runTest() {
    if (!selectedId) return
    navigate(`/packaged-food-test/runs/${encodeURIComponent(selectedId)}?auto=1`)
  }

  async function saveFood() {
    if (!selectedId || !edited) return
    setSaveLoading(true)
    try {
      const body = buildUpdatePayload(edited)
      await adminRequest(`/api/admin/packaged-foods/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      toast.success('已更新到数据库')
      void loadDetail(selectedId)
      void loadList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败')
    } finally {
      setSaveLoading(false)
    }
  }

  function updateValue(path: string, value: any) {
    setEdited((prev) => {
      if (!prev) return prev
      const next = deepClone(prev)
      setValueAtPath(next, path, value)
      return next
    })
  }

  const selectedItem = items.find((item) => item.id === selectedId)

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='packaged-food-test' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-6 pb-8'>
        <header className='page-header'>
          <div>
            <p className='eyebrow'>实验工具 / 包装食品</p>
            <h1>包装食品测试</h1>
          </div>
          <div className='api-pill'>API: {apiBase}</div>
        </header>

        <section className='stats-grid'>
          <article className='stat-card'>
            <span className='stat-label'>当前筛选</span>
            <strong>{total}</strong>
            <span className='stat-foot'>条 SKU</span>
          </article>
          <article className='stat-card'>
            <span className='stat-label'>本页展示</span>
            <strong>{items.length}</strong>
            <span className='stat-foot'>{loading ? '读取中' : '条记录'}</span>
          </article>
          <article className='stat-card'>
            <span className='stat-label'>当前选中</span>
            <strong>{shortTitle(selectedItem?.display_name || selectedItem?.product_name || '-')}</strong>
            <span className='stat-foot'>{selectedItem?.review_status || '无'}</span>
          </article>
        </section>

        <section className='toolbar packaged-toolbar'>
          <label className='wide'>
            搜索
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadList(1)}
              placeholder='品牌 / 商品名 / 条码 / OCR / 搜索文本'
            />
          </label>
          <button type='button' onClick={() => loadList(1)} disabled={loading}>
            {loading ? <RefreshCw className='mr-1 inline size-4 animate-spin' /> : <Search className='mr-1 inline size-4' />}
            刷新
          </button>
          <button className='primary' type='button' onClick={runTest} disabled={!selectedId}>
            <Play className='mr-1 inline size-4' />
            运行识别
          </button>
        </section>

        <section className='statusline'>
          <span>{message}</span>
          <div className='pager'>
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              上一页
            </button>
            <span>
              第 {page} / {totalPages} 页
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              下一页
            </button>
          </div>
        </section>

        <section className='workspace packaged-workspace'>
          <div className='sku-list'>
            {loading ? (
              <>
                <div className='skeleton-row' />
                <div className='skeleton-row' />
                <div className='skeleton-row' />
              </>
            ) : items.length === 0 ? (
              <div className='empty-state'>
                <div className='empty-icon'>∅</div>
                <h2>没有 SKU</h2>
                <p>换个关键词或筛选条件再试。</p>
              </div>
            ) : (
              items.map((item) => (
                <PackagedFoodCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onClick={() => setSelectedId(item.id)}
                />
              ))
            )}
          </div>

          <aside className='detail-panel sku-editor-panel'>
            {!selectedId ? (
              <div className='empty-state'>
                <div className='empty-icon'>∅</div>
                <h2>选择一条 SKU</h2>
                <p>右侧会展示图片、规格、营养、OCR 和搜索字段。</p>
              </div>
            ) : detailLoading ? (
              <div className='empty-state'>
                <RefreshCw className='size-8 animate-spin text-muted-foreground' />
              </div>
            ) : !detail || !edited ? (
              <div className='empty-state'>
                <div className='empty-icon'>!</div>
                <h2>加载详情失败</h2>
              </div>
            ) : (
              <PackagedFoodEditor
                detail={detail}
                edited={edited}
                saveLoading={saveLoading}
                onValueChange={updateValue}
                onRunTest={runTest}
                onSave={saveFood}
              />
            )}
          </aside>
        </section>
      </main>
    </div>
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
      <div className='thumb-strip'>
        {images.length ? (
          images.slice(0, 2).map((src, idx) => (
            <img
              key={`${src}-${idx}`}
              src={src}
              alt={item.display_name || item.product_name}
              loading='lazy'
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ))
        ) : (
          <div className='no-image'>
            <ImageOff className='size-5' />
          </div>
        )}
      </div>
      <div className='sku-body'>
        <h2>{item.display_name || item.product_name || '未命名'}</h2>
        <div className='meta-row'>
          <span className={`pill ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? '启用' : '停用'}</span>
          <span className='pill'>{item.review_status || '空状态'}</span>
          <span className='pill'>{displaySpec(item)}</span>
          <span className='pill'>{images.length} 图</span>
        </div>
        <div className='nutrition-line'>
          <span>
            <strong>{cleanNum(item.kcal_per_100g)}</strong>kcal
          </span>
          <span>
            <strong>{cleanNum(item.protein_per_100g ?? 0)}</strong>蛋白
          </span>
          <span>
            <strong>{cleanNum(item.carbs_per_100g ?? 0)}</strong>碳水
          </span>
          <span>
            <strong>{cleanNum(item.fat_per_100g ?? 0)}</strong>脂肪
          </span>
        </div>
      </div>
    </article>
  )
}

function PackagedFoodEditor({
  detail,
  edited,
  saveLoading,
  onValueChange,
  onRunTest,
  onSave,
}: {
  detail: PackagedFoodDetail
  edited: ExtractResult
  saveLoading: boolean
  onValueChange: (path: string, value: any) => void
  onRunTest: () => void
  onSave: () => void
}) {
  const images = detail.source_image_urls || []

  return (
    <>
      <div className='editor-header'>
        <div>
          <h2>{detail.display_name || detail.product_name || '未命名'}</h2>
          <p>{detail.id}</p>
        </div>
        <div className='actions' style={{ marginTop: 0 }}>
          <button type='button' onClick={onRunTest}>
            <Play className='mr-1 inline size-4' />
            运行识别
          </button>
          <button className='primary' type='button' onClick={onSave} disabled={saveLoading}>
            {saveLoading ? <RefreshCw className='mr-1 inline size-4 animate-spin' /> : <Save className='mr-1 inline size-4' />}
            保存修改
          </button>
        </div>
      </div>

      <section className='detail-section'>
        <h3>图片</h3>
        <div className='image-list'>
          {images.length ? (
            images.map((src, idx) => (
              <a key={`${src}-${idx}`} href={src} target='_blank' rel='noreferrer'>
                <img
                  src={src}
                  alt='商品图片'
                  loading='lazy'
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </a>
            ))
          ) : (
            <div className='no-image'>
              <ImageOff className='size-6' />
            </div>
          )}
        </div>
      </section>

      <EditorSection title='商品与规格'>
        {BASIC_FIELDS.map((field) => (
          <FieldInput key={field.key} field={field} data={edited} onChange={onValueChange} />
        ))}
      </EditorSection>

      <EditorSection title='每100克营养'>
        <div className='form-grid'>
          {NUTRIENT_FIELDS.map((field) => (
            <NumberField
              key={field.key}
              label={`${field.label} (${field.unit})`}
              value={edited.unit_nutrition_per_100g?.[field.key]}
              precision={field.precision}
              onChange={(v) => onValueChange(`unit_nutrition_per_100g.${field.key}`, v)}
            />
          ))}
        </div>
      </EditorSection>

      <EditorSection title='证据与搜索'>
        {EVIDENCE_FIELDS.map((field) => (
          <FieldInput key={field.key} field={field} data={edited} onChange={onValueChange} />
        ))}
      </EditorSection>

      {edited.auto_ingest_result && (
        <section className='detail-section'>
          <h3>识别评估</h3>
          <div className='meta-row'>
            <span
              className={`pill ${edited.auto_ingest_result.status === 'ready' ? 'active' : 'inactive'}`}
            >
              {edited.auto_ingest_result.status === 'ready' ? '可入库' : '不可入库'}
            </span>
            {edited.auto_ingest_result.reason && (
              <span className='pill'>{edited.auto_ingest_result.reason}</span>
            )}
          </div>
          {edited.auto_ingest_result.missing_fields && edited.auto_ingest_result.missing_fields.length > 0 && (
            <div className='mt-2 text-xs text-muted-foreground'>
              缺失字段: {edited.auto_ingest_result.missing_fields.join(', ')}
            </div>
          )}
        </section>
      )}

      <div className='actions'>
        <button type='button' onClick={onRunTest}>
          <Play className='mr-1 inline size-4' />
          运行识别
        </button>
        <button className='primary' type='button' onClick={onSave} disabled={saveLoading}>
          {saveLoading ? <RefreshCw className='mr-1 inline size-4 animate-spin' /> : <Save className='mr-1 inline size-4' />}
          保存修改
        </button>
      </div>
    </>
  )
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='detail-section'>
      <h3>{title}</h3>
      <div className='form-grid'>{children}</div>
    </section>
  )
}

function FieldInput({
  field,
  data,
  onChange,
}: {
  field: FieldDef
  data: ExtractResult
  onChange: (path: string, value: any) => void
}) {
  const value = getValueAtPath(data, field.path)
  const id = `field-${field.key}`

  let input: React.ReactNode
  if (field.type === 'textarea') {
    input = (
      <textarea
        id={id}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(field.path, e.target.value)}
        rows={4}
      />
    )
  } else if (field.type === 'boolean') {
    input = (
      <select
        id={id}
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onChange(field.path, e.target.value === 'true')}
      >
        <option value='true'>是</option>
        <option value='false'>否</option>
      </select>
    )
  } else if (field.type === 'select') {
    input = (
      <select
        id={id}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(field.path, e.target.value)}
      >
        {field.options?.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'number') {
    input = (
      <input
        id={id}
        type='number'
        value={value === undefined || value === null || Number.isNaN(value) ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            onChange(field.path, undefined)
            return
          }
          const n = parseFloat(raw)
          if (!Number.isNaN(n)) {
            onChange(field.path, n)
          }
        }}
      />
    )
  } else {
    input = (
      <input
        id={id}
        type='text'
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    )
  }

  return (
    <div className={`field ${field.wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{field.label}</label>
      {input}
    </div>
  )
}

function NumberField({
  label,
  value,
  precision = 1,
  onChange,
}: {
  label: string
  value?: number
  precision?: number
  onChange: (value?: number) => void
}) {
  const displayValue = value === undefined || Number.isNaN(value) ? '' : roundToPrecision(value, precision).toString()
  return (
    <div className='field'>
      <label>{label}</label>
      <input
        type='number'
        value={displayValue}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            onChange(undefined)
            return
          }
          const n = parseFloat(raw)
          if (!Number.isNaN(n)) {
            onChange(n)
          }
        }}
      />
    </div>
  )
}

function foodToEditable(food: PackagedFoodDetail): ExtractResult {
  return {
    brand: food.brand,
    product_name: food.product_name,
    display_name: food.display_name,
    flavor_text: food.flavor_text,
    spec_text: food.spec_text,
    barcode: food.barcode,
    package_category: food.package_category,
    ingredients_text: food.ingredients_text,
    net_content_value: food.net_content_value,
    net_content_unit: food.net_content_unit,
    unit_count: food.unit_count,
    unit_content_value: food.unit_content_value,
    unit_content_unit: food.unit_content_unit,
    net_weight_g: food.net_weight_g,
    serving_weight_g: food.serving_weight_g,
    nutrition_basis_unit: food.nutrition_basis_unit,
    energy_unit_raw: food.energy_unit_raw,
    conversion_status: food.conversion_status,
    extract_confidence: food.extract_confidence,
    ocr_raw_text: food.ocr_raw_text,
    review_status: food.review_status,
    is_active: food.is_active,
    search_text: food.search_text,
    unit_nutrition_per_100g: {
      calories: food.kcal_per_100g,
      protein: food.protein_per_100g,
      carbs: food.carbs_per_100g,
      fat: food.fat_per_100g,
      fiber: food.fiber_per_100g,
      sugar: food.sugar_per_100g,
      saturatedFat: food.saturated_fat_per_100g,
      cholesterolMg: food.cholesterol_mg_per_100g,
      sodiumMg: food.sodium_mg_per_100g,
      potassiumMg: food.potassium_mg_per_100g,
      calciumMg: food.calcium_mg_per_100g,
      ironMg: food.iron_mg_per_100g,
      magnesiumMg: food.magnesium_mg_per_100g,
      zincMg: food.zinc_mg_per_100g,
      vitaminARaeMcg: food.vitamin_a_rae_mcg_per_100g,
      vitaminCMg: food.vitamin_c_mg_per_100g,
      vitaminDMcg: food.vitamin_d_mcg_per_100g,
      vitaminEMg: food.vitamin_e_mg_per_100g,
      vitaminKMcg: food.vitamin_k_mcg_per_100g,
      thiaminMg: food.thiamin_mg_per_100g,
      riboflavinMg: food.riboflavin_mg_per_100g,
      niacinMg: food.niacin_mg_per_100g,
      vitaminB6Mg: food.vitamin_b6_mg_per_100g,
      folateMcg: food.folate_mcg_per_100g,
      vitaminB12Mcg: food.vitamin_b12_mcg_per_100g,
    },
  }
}

function buildUpdatePayload(edited: ExtractResult): Record<string, any> {
  const payload: Record<string, any> = {}
  const nullableString = (v?: string) => (v === undefined ? undefined : v)
  const nullableNumber = (v?: number) => (v === undefined ? undefined : v)

  payload.brand = edited.brand ?? ''
  payload.product_name = edited.product_name ?? ''
  payload.display_name = edited.display_name ?? ''
  payload.flavor_text = nullableString(edited.flavor_text)
  payload.spec_text = nullableString(edited.spec_text)
  payload.barcode = nullableString(edited.barcode)
  payload.package_category = nullableString(edited.package_category)
  payload.ingredients_text = nullableString(edited.ingredients_text)
  payload.ocr_raw_text = nullableString(edited.ocr_raw_text)
  payload.nutrition_basis_unit = nullableString(edited.nutrition_basis_unit)
  payload.energy_unit_raw = nullableString(edited.energy_unit_raw)
  payload.net_content_value = nullableNumber(edited.net_content_value)
  payload.net_content_unit = nullableString(edited.net_content_unit)
  payload.net_weight_g = nullableNumber(edited.net_weight_g)
  payload.serving_weight_g = nullableNumber(edited.serving_weight_g)
  payload.unit_count = nullableNumber(edited.unit_count)
  payload.unit_content_value = nullableNumber(edited.unit_content_value)
  payload.unit_content_unit = nullableString(edited.unit_content_unit)
  payload.conversion_status = nullableString(edited.conversion_status)
  payload.review_status = nullableString(edited.review_status)
  payload.is_active = edited.is_active ?? true
  payload.search_text = nullableString(edited.search_text)

  const nutrition = edited.unit_nutrition_per_100g || {}
  payload.kcal_per_100g = nullableNumber(nutrition.calories)
  payload.protein_per_100g = nullableNumber(nutrition.protein)
  payload.carbs_per_100g = nullableNumber(nutrition.carbs)
  payload.fat_per_100g = nullableNumber(nutrition.fat)
  payload.fiber_per_100g = nullableNumber(nutrition.fiber)
  payload.sugar_per_100g = nullableNumber(nutrition.sugar)
  payload.saturated_fat_per_100g = nullableNumber(nutrition.saturatedFat)
  payload.cholesterol_mg_per_100g = nullableNumber(nutrition.cholesterolMg)
  payload.sodium_mg_per_100g = nullableNumber(nutrition.sodiumMg)
  payload.potassium_mg_per_100g = nullableNumber(nutrition.potassiumMg)
  payload.calcium_mg_per_100g = nullableNumber(nutrition.calciumMg)
  payload.iron_mg_per_100g = nullableNumber(nutrition.ironMg)
  payload.magnesium_mg_per_100g = nullableNumber(nutrition.magnesiumMg)
  payload.zinc_mg_per_100g = nullableNumber(nutrition.zincMg)
  payload.vitamin_a_rae_mcg_per_100g = nullableNumber(nutrition.vitaminARaeMcg)
  payload.vitamin_c_mg_per_100g = nullableNumber(nutrition.vitaminCMg)
  payload.vitamin_d_mcg_per_100g = nullableNumber(nutrition.vitaminDMcg)
  payload.vitamin_e_mg_per_100g = nullableNumber(nutrition.vitaminEMg)
  payload.vitamin_k_mcg_per_100g = nullableNumber(nutrition.vitaminKMcg)
  payload.thiamin_mg_per_100g = nullableNumber(nutrition.thiaminMg)
  payload.riboflavin_mg_per_100g = nullableNumber(nutrition.riboflavinMg)
  payload.niacin_mg_per_100g = nullableNumber(nutrition.niacinMg)
  payload.vitamin_b6_mg_per_100g = nullableNumber(nutrition.vitaminB6Mg)
  payload.folate_mcg_per_100g = nullableNumber(nutrition.folateMcg)
  payload.vitamin_b12_mcg_per_100g = nullableNumber(nutrition.vitaminB12Mcg)

  return payload
}

function roundToPrecision(value: number, precision: number): number {
  if (value === undefined || value === null || Number.isNaN(value)) return value
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function setValueAtPath(obj: any, path: string, value: any) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) {
      current[keys[i]] = {}
    }
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

function getValueAtPath(obj: any, path: string): any {
  const keys = path.split('.')
  let current = obj
  for (const key of keys) {
    if (current === undefined || current === null) return undefined
    current = current[key]
  }
  return current
}

function shortTitle(value: string): string {
  if (!value) return '-'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

function cleanNum(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  return Number(value).toFixed(1).replace(/\.0$/, '')
}

function displaySpec(item: PackagedFood): string {
  if (item.net_content_value && item.net_content_unit) return `${item.net_content_value}${item.net_content_unit}`
  if (item.net_weight_g) return `${item.net_weight_g}g`
  return '无规格'
}
