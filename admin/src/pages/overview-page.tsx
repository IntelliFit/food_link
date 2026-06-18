import { useEffect, useState } from 'react'
import { Flag, LayoutDashboard, MessageSquareText, Package } from 'lucide-react'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, displayApiBase } from '@/lib/api'

type OverviewPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type StatusStats = Record<string, number>

const feedbackStatusLabels: Record<string, string> = {
  open: '待处理',
  resolved: '已采纳',
  closed: '不采纳',
}

const feedReportStatusLabels: Record<string, string> = {
  pending: '待处理',
  resolved: '已处理',
  rejected: '已驳回',
}

/** 总览页：保留主分支历史代码中的模块入口卡片，并聚合反馈/举报状态数据 */
export function OverviewPage({ onLogout, onMenuChange }: OverviewPageProps) {
  const apiBase = displayApiBase()
  const [feedbackStats, setFeedbackStats] = useState<StatusStats | null>(null)
  const [feedReportStats, setFeedReportStats] = useState<StatusStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    async function loadStats() {
      setLoadingStats(true)
      try {
        const [feedbackData, reportData] = await Promise.all([
          adminRequest<{ stats: StatusStats }>('/api/admin/feedback/stats'),
          adminRequest<{ stats: StatusStats }>('/api/admin/feed-reports/stats'),
        ])
        setFeedbackStats(feedbackData.stats)
        setFeedReportStats(reportData.stats)
      } catch {
        setFeedbackStats(null)
        setFeedReportStats(null)
      } finally {
        setLoadingStats(false)
      }
    }
    void loadStats()
  }, [])

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="overview" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0 space-y-6 pb-8">
        <PageHeader eyebrow="统一后台" title="Food Link Admin Console" apiBase={apiBase} />
        <section className="stats-grid overview-stats">
          <Stat label="已接入模块" value="4" foot="反馈 / 包装食品 / 举报 / 评测" />
          <Stat label="保留入口" value="1" foot="系统设置" />
          <Stat label="统一登录" value="Admin" foot="HttpOnly Cookie" />
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <StatusCard
            icon={<MessageSquareText className="size-6" />}
            title="意见反馈"
            labels={feedbackStatusLabels}
            stats={feedbackStats}
            loading={loadingStats}
            onClick={() => onMenuChange('feedback')}
          />
          <StatusCard
            icon={<Flag className="size-6" />}
            title="举报管理"
            labels={feedReportStatusLabels}
            stats={feedReportStats}
            loading={loadingStats}
            onClick={() => onMenuChange('feed-reports')}
          />
        </section>
        <section className="module-grid">
          <ModuleCard
            icon={<MessageSquareText className="size-6" />}
            title="意见反馈"
            desc="用户反馈、联系方式、客户端信息、trace 与最近请求。"
            action="打开反馈"
            onClick={() => onMenuChange('feedback')}
          />
          <ModuleCard
            icon={<Package className="size-6" />}
            title="包装食品库"
            desc="替代旧零食临时后台，支持搜索、筛选、图片预览与快速编辑。"
            action="管理 SKU"
            onClick={() => onMenuChange('packaged-foods')}
          />
          <ModuleCard
            icon={<LayoutDashboard className="size-6" />}
            title="数据集评测"
            desc="食品分析 benchmark、样本管理与评测结果对比。"
            action="查看入口"
            onClick={() => onMenuChange('benchmark')}
          />
          <ModuleCard
            icon={<Flag className="size-6" />}
            title="举报管理"
            desc="社区内容举报记录、被举报目标快照与处理状态。"
            action="处理举报"
            onClick={() => onMenuChange('feed-reports')}
          />
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

function StatusCard({
  icon,
  title,
  labels,
  stats,
  loading,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  labels: Record<string, string>
  stats: StatusStats | null
  loading: boolean
  onClick: () => void
}) {
  const total = stats
    ? Object.values(stats).reduce((sum, count) => sum + (count || 0), 0)
    : 0

  return (
    <article className="module-card cursor-pointer" onClick={onClick} role="button" tabIndex={0}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-primary">{icon}</div>
        <span className="text-2xl font-bold">{loading ? '-' : total}</span>
      </div>
      <h2>{title}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Object.entries(labels).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-semibold">
              {loading ? <span className="inline-block w-4 animate-pulse rounded bg-muted"> </span> : stats?.[key] ?? 0}
            </span>
          </div>
        ))}
      </div>
    </article>
  )
}

function ModuleCard({
  icon,
  title,
  desc,
  action,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  action: string
  onClick: () => void
}) {
  return (
    <article className="module-card">
      <div className="mb-3 text-primary">{icon}</div>
      <h2>{title}</h2>
      <p>{desc}</p>
      <button className="primary" type="button" onClick={onClick}>
        {action}
      </button>
    </article>
  )
}
