import { LayoutDashboard, MessageSquareText, Package } from 'lucide-react'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { displayApiBase } from '@/lib/api'

type OverviewPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

/** 总览页：保留主分支历史代码中的模块入口卡片 */
export function OverviewPage({ onLogout, onMenuChange }: OverviewPageProps) {
  const apiBase = displayApiBase()
  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="overview" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0 space-y-6 pb-8">
        <PageHeader eyebrow="统一后台" title="Food Link Admin Console" apiBase={apiBase} />
        <section className="stats-grid overview-stats">
          <Stat label="已接入模块" value="3" foot="反馈 / 包装食品 / 举报" />
          <Stat label="保留入口" value="2" foot="数据集评测 / 系统设置" />
          <Stat label="统一登录" value="Admin" foot="HttpOnly Cookie" />
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
