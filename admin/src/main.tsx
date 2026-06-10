import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const API_BASE_URL = (import.meta.env.VITE_ADMIN_API_BASE_URL || '').replace(/\/+$/, '')

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

type ListResponse = {
  items: FeedbackItem[]
  page: number
  limit: number
  total: number
}

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

function App() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('feedback_admin_key') || '')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('准备加载')
  const [toast, setToast] = useState('')

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId])
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, category, status])

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
        ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
        ...(options.headers || {}),
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.code !== 0) {
      throw new Error(body.message || `请求失败 ${res.status}`)
    }
    return body.data as T
  }

  async function loadList(nextPage = page) {
    setLoading(true)
    setMessage('加载反馈中...')
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        category,
        status,
      })
      const data = await request<ListResponse>(`/api/admin/feedback?${params.toString()}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedId((current) => current || data.items?.[0]?.id || '')
      setMessage(`共 ${data.total || 0} 条反馈，当前显示 ${(data.items || []).length} 条`)
    } catch (error) {
      const text = error instanceof Error ? error.message : '加载失败'
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

  function applyAdminKey() {
    localStorage.setItem('feedback_admin_key', adminKey.trim())
    setToast('管理员密钥已应用')
    void loadList(1)
  }

  function runSearch() {
    setPage(1)
    void loadList(1)
  }

  return (
    <>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <main className="admin-shell">
        <header className="hero">
          <div className="brand-mark"><span className="brand-dot" />Food Link Admin</div>
          <div className="hero-main">
            <div>
              <p className="eyebrow">用户声音 / Trace 诊断</p>
              <h1>意见反馈管理</h1>
              <p className="hero-desc">集中查看小程序用户反馈，快速复制 traceId、定位最近请求链路，并跟进处理状态。</p>
            </div>
            <form className="auth-card" onSubmit={(event) => { event.preventDefault(); applyAdminKey() }}>
              <label>管理员密钥
                <input value={adminKey} onChange={(event) => setAdminKey(event.target.value)} type="password" placeholder="可留空使用测试后台登录态" />
              </label>
              <button type="submit">应用密钥</button>
              <span className="api-base">API: {API_BASE_URL || '同源'}</span>
            </form>
          </div>
        </header>

        <section className="stats-grid">
          <Stat label="当前筛选" value={String(total)} foot="条反馈" />
          <Stat label="本页展示" value={String(items.length)} foot={loading ? '加载中' : '条记录'} />
          <Stat label="最近提交" value={items[0] ? formatTime(items[0].created_at, true) : '-'} foot="按提交时间倒序" />
        </section>

        <section className="toolbar">
          <label className="wide">搜索
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }} placeholder="反馈内容 / 联系方式 / traceId / requestId / userId" />
          </label>
          <label>类型
            <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
              <option value="all">全部类型</option>
              <option value="bug">问题反馈</option>
              <option value="suggestion">功能建议</option>
              <option value="experience">使用体验</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label>状态
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <option value="all">全部状态</option>
              <option value="open">待处理</option>
              <option value="processing">处理中</option>
              <option value="resolved">已解决</option>
              <option value="closed">已关闭</option>
            </select>
          </label>
          <label>每页
            <select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1) }}>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button className="primary" type="button" onClick={runSearch}>刷新</button>
        </section>

        <section className="statusline">
          <span>{message}</span>
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <span>第 {page} / {totalPages} 页</span>
            <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
          </div>
        </section>

        <section className="workspace">
          <div className="feedback-list">
            {items.length === 0 ? (
              <Empty title={loading ? '加载中' : '没有反馈'} desc={loading ? '正在读取反馈列表。' : '换个筛选条件，或等待用户提交新的反馈。'} />
            ) : items.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                selected={item.id === selected?.id}
                onClick={() => setSelectedId(item.id)}
                onCopy={(text) => void copyText(text, setToast)}
              />
            ))}
          </div>
          <aside className="detail-panel">
            {selected ? (
              <FeedbackDetail item={selected} onStatusChange={updateStatus} onCopy={(text) => void copyText(text, setToast)} />
            ) : (
              <Empty title="选择一条反馈" desc="右侧会展示用户、联系方式、提交 trace、客户端信息和最近请求列表。" />
            )}
          </aside>
        </section>
      </main>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  )
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <article className="stat-card"><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-foot">{foot}</span></article>
}

function Empty({ title, desc }: { title: string; desc: string }) {
  return <div className="empty-state"><div className="empty-icon">⌁</div><h2>{title}</h2><p>{desc}</p></div>
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

function displayUser(item: FeedbackItem): string {
  return item.user_nickname || item.user_telephone || shortId(item.user_id || '') || '未知用户'
}

function firstTraceId(item: FeedbackItem): string {
  const found = item.recent_requests?.find((trace) => trace.traceId || trace.trace_id)
  return found ? (found.traceId || found.trace_id || '') : ''
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-6)}`
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
