import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { getAdminApiBaseUrl } from './config'
import './styles.css'

const API_BASE_URL = getAdminApiBaseUrl()

type MenuId = 'overview' | 'feedback' | 'packaged-foods' | 'quality' | 'test-backend' | 'behavior'
type FeedbackStatus = 'open' | 'processing' | 'resolved' | 'closed'
type FeedbackCategory = 'bug' | 'suggestion' | 'experience' | 'other'

type RecentRequestTrace = {
  method?: string
  path?: string
  statusCode?: number
  status_code?: number
  durationMs?: number
  duration_ms?: number
  startedAt?: string
  started_at?: string
  traceId?: string
  trace_id?: string
  requestId?: string
  request_id?: string
  hostName?: string
  host_name?: string
  errorMessage?: string
  error_message?: string
}

type FeedbackItem = {
  id: string
  user_id: string
  category: FeedbackCategory
  content: string
  contact: string
  page_path: string
  app_version: string
  client_info: Record<string, unknown>
  recent_requests: RecentRequestTrace[]
  submit_trace_id: string
  submit_request_id: string
  submit_host_name: string
  status: FeedbackStatus
  created_at: string
  updated_at: string
  user_nickname?: string
  user_avatar?: string
  user_telephone?: string
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

type AdminRequest = <T>(path: string, options?: RequestInit) => Promise<T>

const categoryLabels: Record<string, string> = {
  bug: '问题反馈',
  suggestion: '功能建议',
  experience: '使用体验',
  other: '其他',
}

const statusLabels: Record<FeedbackStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const packagedFields = [
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
] as const

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [activeMenu, setActiveMenu] = useState<MenuId>(() => {
    const saved = window.localStorage.getItem('admin.activeMenu') as MenuId | null
    return saved || 'overview'
  })
  const [toast, setToast] = useState('')

  useEffect(() => {
    void checkSession()
  }, [])

  useEffect(() => {
    window.localStorage.setItem('admin.activeMenu', activeMenu)
  }, [activeMenu])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.code !== 0) {
      throw new Error(body.message || `请求失败 ${res.status}`)
    }
    return body.data as T
  }

  async function checkSession() {
    setCheckingSession(true)
    try {
      await request<{ authenticated: boolean }>('/api/admin/session')
      setAuthenticated(true)
    } catch {
      setAuthenticated(false)
    } finally {
      setCheckingSession(false)
    }
  }

  async function login(username: string, password: string) {
    await request<{ authenticated: boolean }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setAuthenticated(true)
    setToast('登录成功')
  }

  async function logout() {
    try {
      await request<{ authenticated: boolean }>('/api/admin/logout', { method: 'POST' })
    } finally {
      setAuthenticated(false)
      setToast('已退出登录')
    }
  }

  if (checkingSession) {
    return (
      <main className="boot-screen">
        <Spinner />
        <div className="brand-mark"><span className="brand-dot" />Food Link Admin</div>
      </main>
    )
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} apiBase={API_BASE_URL || '同源'} toast={toast} setToast={setToast} />
  }

  return (
    <>
      <div className="dashboard-shell">
        <Sidebar activeMenu={activeMenu} onSelect={setActiveMenu} onLogout={() => void logout()} />
        <main className="content-shell">
          {activeMenu === 'overview' ? <OverviewPage apiBase={API_BASE_URL || '同源'} onSelect={setActiveMenu} /> : null}
          {activeMenu === 'feedback' ? <FeedbackPage request={request} setToast={setToast} apiBase={API_BASE_URL || '同源'} /> : null}
          {activeMenu === 'packaged-foods' ? <PackagedFoodsPage request={request} setToast={setToast} apiBase={API_BASE_URL || '同源'} /> : null}
          {activeMenu === 'quality' ? <QualityPage /> : null}
          {activeMenu === 'test-backend' ? <TestBackendPage /> : null}
          {activeMenu === 'behavior' ? <BehaviorPage /> : null}
        </main>
      </div>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  )
}

function LoginPage({ onLogin, apiBase, toast, setToast }: { onLogin: (username: string, password: string) => Promise<void>; apiBase: string; toast: string; setToast: (value: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password.trim()) {
      setToast('请输入管理员账号和密码')
      return
    }
    setSubmitting(true)
    try {
      await onLogin(username, password)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark"><span className="brand-dot" />Food Link Admin</div>
        <h1>管理员登录</h1>
        <form onSubmit={submit}>
          <label>管理员账号
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="username" placeholder="请输入管理员账号" />
          </label>
          <label>密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="请输入密码" />
          </label>
          <button className="primary" type="submit" disabled={submitting}>{submitting ? <Spinner small /> : '登录'}</button>
        </form>
        <span className="api-base">API: {apiBase}</span>
      </section>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </main>
  )
}

function Sidebar({ activeMenu, onSelect, onLogout }: { activeMenu: MenuId; onSelect: (id: MenuId) => void; onLogout: () => void }) {
  const menus: Array<{ id: MenuId; label: string; desc: string }> = [
    { id: 'overview', label: '总览', desc: '后台入口' },
    { id: 'feedback', label: '意见反馈', desc: '用户声音' },
    { id: 'packaged-foods', label: '包装食品库', desc: '零食 SKU' },
    { id: 'quality', label: '质量审计', desc: '识别异常' },
    { id: 'test-backend', label: '测试后台', desc: '测试集' },
    { id: 'behavior', label: '行为统计', desc: '埋点漏斗' },
  ]
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-dot" />
        <div><strong>Food Link</strong><span>Admin Console</span></div>
      </div>
      <nav className="menu-list">
        {menus.map((menu) => (
          <button key={menu.id} type="button" className={`menu-item ${activeMenu === menu.id ? 'active' : ''}`} onClick={() => onSelect(menu.id)}>
            <span>{menu.label}</span>
            <small>{menu.desc}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button type="button" onClick={onLogout}>退出登录</button>
      </div>
    </aside>
  )
}

function OverviewPage({ apiBase, onSelect }: { apiBase: string; onSelect: (id: MenuId) => void }) {
  return (
    <>
      <PageHeader eyebrow="统一后台" title="Food Link Admin Console" apiBase={apiBase} />
      <section className="stats-grid overview-stats">
        <Stat label="已接入模块" value="2" foot="反馈 / 包装食品" />
        <Stat label="保留入口" value="2" foot="测试后台 / 质量审计" />
        <Stat label="统一登录" value="Admin" foot="HttpOnly Cookie" />
      </section>
      <section className="module-grid">
        <ModuleCard title="意见反馈" desc="用户反馈、联系方式、客户端信息、trace 与最近请求。" action="打开反馈" onClick={() => onSelect('feedback')} />
        <ModuleCard title="包装食品库" desc="替代旧零食临时后台，支持搜索、筛选、图片预览与快速编辑。" action="管理 SKU" onClick={() => onSelect('packaged-foods')} />
        <ModuleCard title="识别质量审计" desc="承接 0 营养、热量异常、宏量不闭合、候选未确认等报告。" action="查看入口" onClick={() => onSelect('quality')} />
        <ModuleCard title="测试后台" desc="保留现有测试集、prompt、批量分析能力，后续迁入本控制台。" action="查看入口" onClick={() => onSelect('test-backend')} />
      </section>
    </>
  )
}

function FeedbackPage({ request, setToast, apiBase }: { request: AdminRequest; setToast: (value: string) => void; apiBase: string }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('尚未读取')

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId])
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
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
      const data = await request<ListResponse<FeedbackItem>>(`/api/admin/feedback?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedId((current) => current || data.items?.[0]?.id || '')
      setMessage(`共 ${data.total || 0} 条，当前显示 ${(data.items || []).length} 条`)
    } catch (error) {
      const text = error instanceof Error ? error.message : '读取失败'
      setMessage(text)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(id: string, nextStatus: FeedbackStatus) {
    try {
      const data = await request<{ item: FeedbackItem }>(`/api/admin/feedback/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      setItems((current) => current.map((item) => item.id === id ? data.item : item))
      setSelectedId(id)
      setToast('状态已更新')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '状态更新失败')
    }
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <>
      <PageHeader eyebrow="用户声音 / Trace 诊断" title="意见反馈" apiBase={apiBase} />
      <section className="stats-grid">
        <Stat label="当前筛选" value={String(total)} foot="条反馈" />
        <Stat label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
        <Stat label="最近提交" value={items[0] ? formatTime(items[0].created_at, true) : '-'} foot="按提交时间倒序" />
      </section>
      <section className="toolbar feedback-toolbar">
        <label className="wide">搜索
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }} placeholder="反馈内容 / 联系方式 / traceId / requestId / userId" />
        </label>
        <SelectLabel label="类型" value={category} onChange={(value) => { setCategory(value); setPage(1) }} options={[['all', '全部类型'], ['bug', '问题反馈'], ['suggestion', '功能建议'], ['experience', '使用体验'], ['other', '其他']]} />
        <SelectLabel label="状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={[['all', '全部状态'], ['open', '待处理'], ['processing', '处理中'], ['resolved', '已解决'], ['closed', '已关闭']]} />
        <SelectLabel label="每页" value={String(limit)} onChange={(value) => { setLimit(Number(value)); setPage(1) }} options={[['20', '20'], ['30', '30'], ['50', '50'], ['100', '100']]} />
        <button className="primary" type="button" onClick={runSearch}>刷新</button>
      </section>
      <StatusLine message={message} page={page} totalPages={totalPages} setPage={setPage} />
      <section className="workspace feedback-workspace">
        <div className="feedback-list">
          {loading ? <SkeletonRows /> : null}
          {!loading && items.length === 0 ? <Empty title="没有反馈" desc="换个筛选条件，或等待用户提交新的反馈。" /> : null}
          {!loading ? items.map((item) => (
            <FeedbackCard key={item.id} item={item} selected={item.id === selected?.id} onClick={() => setSelectedId(item.id)} onCopy={(text) => void copyText(text, setToast)} />
          )) : null}
        </div>
        <aside className="detail-panel">
          {selected ? <FeedbackDetail item={selected} onStatusChange={updateStatus} onCopy={(text) => void copyText(text, setToast)} /> : <Empty title="选择一条反馈" desc="右侧会展示用户、联系方式、提交 trace、客户端信息和最近请求列表。" />}
        </aside>
      </section>
    </>
  )
}

function PackagedFoodsPage({ request, setToast, apiBase }: { request: AdminRequest; setToast: (value: string) => void; apiBase: string }) {
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

  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
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
      const data = await request<ListResponse<PackagedFood>>(`/api/admin/packaged-foods?${params.toString()}`)
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
      const data = await request<{ item: PackagedFood }>(`/api/admin/packaged-foods/${encodeURIComponent(id)}`)
      setSelected(data.item)
      setItems((current) => current.map((item) => item.id === id ? data.item : item))
    } catch (error) {
      setToast(error instanceof Error ? error.message : '详情读取失败')
    }
  }

  async function saveItem(id: string, payload: Record<string, string | number | boolean | string[]>) {
    setSaving(true)
    try {
      const data = await request<{ item: PackagedFood }>(`/api/admin/packaged-foods/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setSelected(data.item)
      setItems((current) => current.map((item) => item.id === id ? data.item : item))
      setToast('保存成功')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <>
      <PageHeader eyebrow="零食 SKU / 包装食品库" title="包装食品库" apiBase={apiBase} />
      <section className="stats-grid">
        <Stat label="当前筛选" value={String(total)} foot="条 SKU" />
        <Stat label="本页展示" value={String(items.length)} foot={loading ? '读取中' : '条记录'} />
        <Stat label="当前选中" value={selected ? shortTitle(selected.display_name || selected.product_name) : '-'} foot={selected?.review_status || '无'} />
      </section>
      <section className="toolbar packaged-toolbar">
        <label className="wide">搜索
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }} placeholder="品牌 / 商品名 / 条码 / OCR / 搜索文本" />
        </label>
        <SelectLabel label="审核" value={reviewStatus} onChange={(value) => { setReviewStatus(value); setPage(1) }} options={[['all', '全部状态'], ['active', 'active'], ['pending', 'pending'], ['web_verified', 'web_verified'], ['rejected', 'rejected'], ['inactive', 'inactive'], ['blank', '空状态']]} />
        <SelectLabel label="启用" value={active} onChange={(value) => { setActive(value); setPage(1) }} options={[['all', '全部'], ['true', '启用'], ['false', '停用']]} />
        <SelectLabel label="图片" value={imageState} onChange={(value) => { setImageState(value); setPage(1) }} options={[['all', '全部'], ['with_images', '有图'], ['missing_images', '缺图']]} />
        <SelectLabel label="每页" value={String(limit)} onChange={(value) => { setLimit(Number(value)); setPage(1) }} options={[['20', '20'], ['40', '40'], ['60', '60'], ['100', '100']]} />
        <button className="primary" type="button" onClick={runSearch}>刷新</button>
      </section>
      <StatusLine message={message} page={page} totalPages={totalPages} setPage={setPage} />
      <section className="workspace packaged-workspace">
        <div className="sku-list">
          {loading ? <SkeletonRows /> : null}
          {!loading && items.length === 0 ? <Empty title="没有 SKU" desc="换个关键词或筛选条件再试。" /> : null}
          {!loading ? items.map((item) => (
            <PackagedFoodCard key={item.id} item={item} selected={item.id === selected?.id} onClick={() => void loadDetail(item.id)} />
          )) : null}
        </div>
        <aside className="detail-panel sku-editor-panel">
          {selected ? <PackagedFoodEditor key={selected.id} item={selected} saving={saving} onSave={saveItem} onCopy={(text) => void copyText(text, setToast)} /> : <Empty title="选择一条 SKU" desc="右侧会展示图片、规格、核心营养、OCR 和搜索字段。" />}
        </aside>
      </section>
    </>
  )
}

function QualityPage() {
  return (
    <>
      <PageHeader eyebrow="识别质量" title="质量审计" apiBase={API_BASE_URL || '同源'} />
      <section className="module-grid">
        <ToolCard title="0 营养 Benchmark" command="cd backend && go run ./cmd/zero-nutrition-benchmark --config-dir ." />
        <ToolCard title="全量质量审计" command="cd backend && go run ./cmd/food-analysis-quality-audit --config-dir ." />
        <ToolCard title="包装召回 Benchmark" command="cd backend && go run ./cmd/packaged-recall-benchmark --config-dir ." />
        <ToolCard title="标准库召回 Benchmark" command="cd backend && go run ./cmd/nutrition-recall-benchmark --config-dir ." />
      </section>
    </>
  )
}

function TestBackendPage() {
  return (
    <>
      <PageHeader eyebrow="测试集 / Prompt / 批量分析" title="测试后台入口" apiBase={API_BASE_URL || '同源'} />
      <section className="module-grid">
        <ExternalCard title="旧测试后台" href={`${API_BASE_URL || ''}/test-backend`} desc="保留 prompt、dataset、batch 和单图测试能力。" />
        <ToolCard title="API 契约测试" command="npm run test:backend:api-contract" />
        <ToolCard title="小程序 E2E Smoke" command="npm run test:e2e-weapp:smoke" />
        <ToolCard title="灰度套件" command="cd backend && go run ./cmd/food-analysis-gray-verify --config-dir ." />
      </section>
    </>
  )
}

function BehaviorPage() {
  return (
    <>
      <PageHeader eyebrow="行为统计" title="行为统计" apiBase={API_BASE_URL || '同源'} />
      <section className="empty-band">
        <Empty title="待接入埋点聚合" desc="建议先收敛上传、识别、保存、纠错、分享、反馈六条主漏斗，再做图表。" />
      </section>
    </>
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

function SelectLabel({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label>{label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function StatusLine({ message, page, totalPages, setPage }: { message: string; page: number; totalPages: number; setPage: (value: number | ((current: number) => number)) => void }) {
  return (
    <section className="statusline">
      <span>{message}</span>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
        <span>第 {page} / {totalPages} 页</span>
        <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
      </div>
    </section>
  )
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <article className="stat-card"><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-foot">{foot}</span></article>
}

function ModuleCard({ title, desc, action, onClick }: { title: string; desc: string; action: string; onClick: () => void }) {
  return <article className="module-card"><h2>{title}</h2><p>{desc}</p><button className="primary" type="button" onClick={onClick}>{action}</button></article>
}

function ToolCard({ title, command }: { title: string; command: string }) {
  return <article className="module-card"><h2>{title}</h2><pre className="command-block">{command}</pre></article>
}

function ExternalCard({ title, href, desc }: { title: string; href: string; desc: string }) {
  return <article className="module-card"><h2>{title}</h2><p>{desc}</p><a className="button-link" href={href}>打开</a></article>
}

function Empty({ title, desc }: { title: string; desc: string }) {
  return <div className="empty-state"><div className="empty-icon">∅</div><h2>{title}</h2><p>{desc}</p></div>
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

function FeedbackCard({ item, selected, onClick, onCopy }: { item: FeedbackItem; selected: boolean; onClick: () => void; onCopy: (text: string) => void }) {
  const trace = item.submit_trace_id || firstTraceId(item)
  return (
    <article className={`feedback-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div>
        <div className="feedback-head">
          <span className="category">{categoryLabels[item.category] || item.category}</span>
          <span className={`status ${item.status}`}>{statusLabels[item.status] || item.status}</span>
          <span className="feedback-time">{formatTime(item.created_at)}</span>
        </div>
        <p className="feedback-content">{truncate(item.content, 220)}</p>
        <div className="feedback-meta">
          <span>{displayUser(item)}</span>
          <span>{item.app_version ? `v${item.app_version}` : '未知版本'}</span>
          <span>{item.recent_requests?.length || 0} 条请求</span>
          <span>{trace ? `trace ${shortId(trace)}` : '无 trace'}</span>
        </div>
      </div>
      <div className="feedback-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" disabled={!trace} onClick={() => onCopy(trace)}>复制 trace</button>
        <button type="button" onClick={onClick}>查看详情</button>
      </div>
    </article>
  )
}

function FeedbackDetail({ item, onStatusChange, onCopy }: { item: FeedbackItem; onStatusChange: (id: string, status: FeedbackStatus) => Promise<void>; onCopy: (text: string) => void }) {
  return (
    <>
      <div className="detail-header">
        <div><span className="category">{categoryLabels[item.category] || item.category}</span> <span className={`status ${item.status}`}>{statusLabels[item.status] || item.status}</span></div>
        <select value={item.status} onChange={(event) => void onStatusChange(item.id, event.target.value as FeedbackStatus)}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <section className="detail-section"><h3>反馈内容</h3><p className="feedback-content">{item.content}</p></section>
      <section className="detail-section">
        <h3>提交信息</h3>
        <dl className="kv-grid">
          <KV k="反馈 ID" v={item.id} />
          <KV k="用户" v={displayUser(item)} />
          <KV k="用户 ID" v={item.user_id} />
          <KV k="联系方式" v={item.contact || '未填写'} />
          <KV k="手机号" v={item.user_telephone || '未绑定'} />
          <KV k="页面" v={item.page_path || '未知'} />
          <KV k="版本" v={item.app_version ? `v${item.app_version}` : '未知'} />
          <KV k="提交时间" v={formatTime(item.created_at)} />
          <KV k="submit trace" v={item.submit_trace_id || '无'} />
          <KV k="submit request" v={item.submit_request_id || '无'} />
          <KV k="host" v={item.submit_host_name || '无'} />
        </dl>
        <div className="detail-actions">
          <button type="button" onClick={() => onCopy(item.id)}>复制反馈 ID</button>
          <button type="button" disabled={!item.submit_trace_id} onClick={() => onCopy(item.submit_trace_id)}>复制提交 trace</button>
        </div>
      </section>
      <section className="detail-section"><h3>客户端信息</h3><pre className="code-block">{JSON.stringify(item.client_info || {}, null, 2)}</pre></section>
      <section className="detail-section">
        <h3>最近请求 ({item.recent_requests?.length || 0})</h3>
        <div className="trace-list">
          {item.recent_requests?.length ? item.recent_requests.map((trace, index) => <TraceCard key={`${trace.traceId || trace.trace_id || index}-${index}`} trace={trace} index={index} onCopy={onCopy} />) : <p className="muted">用户未附带最近请求诊断。</p>}
        </div>
      </section>
    </>
  )
}

function PackagedFoodCard({ item, selected, onClick }: { item: PackagedFood; selected: boolean; onClick: () => void }) {
  const images = item.source_image_urls || []
  return (
    <article className={`sku-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="thumb-strip">
        {images.length ? images.slice(0, 2).map((src) => <img key={src} src={src} alt={item.display_name || item.product_name} loading="lazy" />) : <div className="no-image">缺图</div>}
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
          <span><strong>{cleanNum(item.kcal_per_100g)}</strong>kcal</span>
          <span><strong>{cleanNum(item.protein_per_100g)}</strong>蛋白</span>
          <span><strong>{cleanNum(item.carbs_per_100g)}</strong>碳水</span>
          <span><strong>{cleanNum(item.fat_per_100g)}</strong>脂肪</span>
        </div>
      </div>
    </article>
  )
}

function PackagedFoodEditor({ item, saving, onSave, onCopy }: { item: PackagedFood; saving: boolean; onSave: (id: string, payload: Record<string, string | number | boolean | string[]>) => Promise<void>; onCopy: (text: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload: Record<string, string | number | boolean | string[]> = {}
    packagedFields.forEach((field) => {
      if (!form.has(field.key)) return
      const raw = String(form.get(field.key) ?? '').trim()
      if (field.key === 'source_image_urls') {
        payload[field.key] = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean)
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
        <button type="button" onClick={() => onCopy(item.id)}>复制 ID</button>
      </div>
      <section className="detail-section">
        <h3>图片</h3>
        <div className="image-list">
          {images.length ? images.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="商品图片" loading="lazy" /></a>) : <p className="muted">这条记录没有图片。</p>}
        </div>
      </section>
      <EditorSection title="商品与规格" item={item} group="basic" />
      <EditorSection title="核心营养" item={item} group="nutrition" />
      <EditorSection title="证据与搜索" item={item} group="evidence" />
      <div className="actions">
        <button type="button" onClick={() => onCopy(item.product_key || '')} disabled={!item.product_key}>复制 product_key</button>
        <button className="primary" type="submit" disabled={saving}>{saving ? <Spinner small /> : '保存修改'}</button>
      </div>
    </form>
  )
}

function EditorSection({ title, item, group }: { title: string; item: PackagedFood; group: 'basic' | 'nutrition' | 'evidence' }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <div className="form-grid">
        {packagedFields.filter((field) => field.group === group).map((field) => <PackagedField key={field.key} item={item} field={field} />)}
      </div>
    </section>
  )
}

function PackagedField({ item, field }: { item: PackagedFood; field: (typeof packagedFields)[number] }) {
  const rawValue = getPackagedValue(item, field.key)
  const value = field.key === 'source_image_urls' ? (item.source_image_urls || []).join('\n') : rawValue
  const wide = ('wide' in field && field.wide) || field.type === 'textarea'
  const className = `field ${wide ? 'wide' : ''}`
  if (field.type === 'textarea') {
    return <div className={className}><label>{field.label}<textarea name={field.key} rows={field.key === 'ocr_raw_text' ? 8 : 4} defaultValue={String(value || '')} /></label></div>
  }
  if (field.type === 'select') {
    const options = ['active', 'pending', 'web_verified', 'rejected_missing_net_content', 'rejected', 'inactive']
    return <div className={className}><label>{field.label}<select name={field.key} defaultValue={String(value || 'active')}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>
  }
  if (field.type === 'boolean') {
    return <div className={className}><label>{field.label}<select name={field.key} defaultValue={item.is_active ? 'true' : 'false'}><option value="true">启用</option><option value="false">停用</option></select></label></div>
  }
  return <div className={className}><label>{field.label}<input name={field.key} type={field.type} step={field.type === 'number' ? '0.01' : undefined} defaultValue={String(value ?? '')} /></label></div>
}

function TraceCard({ trace, index, onCopy }: { trace: RecentRequestTrace; index: number; onCopy: (text: string) => void }) {
  const traceId = trace.traceId || trace.trace_id || ''
  return (
    <article className="trace-card">
      <div className="trace-title">
        <span>{index + 1}. {trace.method || 'GET'} · {trace.statusCode || trace.status_code || '无状态码'} · {trace.durationMs || trace.duration_ms || 0}ms</span>
        <button type="button" disabled={!traceId} onClick={() => onCopy(traceId)}>复制 trace</button>
      </div>
      <div className="trace-path">{trace.path || '/'}</div>
      <dl className="kv-grid trace-kv">
        <KV k="traceId" v={traceId || '无'} />
        <KV k="requestId" v={trace.requestId || trace.request_id || '无'} />
        <KV k="host" v={trace.hostName || trace.host_name || '无'} />
        <KV k="startedAt" v={trace.startedAt || trace.started_at || '无'} />
        {(trace.errorMessage || trace.error_message) ? <KV k="error" v={trace.errorMessage || trace.error_message || ''} /> : null}
      </dl>
    </article>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v || '无'}</dd></>
}

function getPackagedValue(item: PackagedFood, key: (typeof packagedFields)[number]['key']): string | number | boolean | string[] | undefined {
  return item[key as keyof PackagedFood] as string | number | boolean | string[] | undefined
}

function displayUser(item: FeedbackItem): string {
  return item.user_nickname || item.user_telephone || shortId(item.user_id || '') || '未知用户'
}

function firstTraceId(item: FeedbackItem): string {
  const found = item.recent_requests?.find((trace) => trace.traceId || trace.trace_id)
  return found ? (found.traceId || found.trace_id || '') : ''
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-6)}`
}

function shortTitle(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 8)}...`
}

function displaySpec(item: PackagedFood): string {
  if (item.net_content_value && item.net_content_unit) return `${cleanNum(item.net_content_value)}${item.net_content_unit}`
  if (item.net_weight_g) return `${cleanNum(item.net_weight_g)}g`
  return item.spec_text || '无规格'
}

function cleanNum(value: number | undefined): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n))
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatTime(value: string, short = false): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(short ? {} : { year: 'numeric', second: '2-digit' }),
  }).format(date)
}

async function copyText(text: string, setToast: (message: string) => void) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    setToast('已复制')
  } catch {
    setToast('复制失败，请手动选择文本')
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
