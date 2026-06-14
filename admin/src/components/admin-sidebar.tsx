import type { ComponentType } from 'react'
import {
  Flag,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Package,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand-mark'

export type AdminMenuId = 'overview' | 'feedback' | 'benchmark' | 'packaged-foods' | 'feed-reports' | 'settings'

type AdminSidebarProps = {
  activeMenu: AdminMenuId
  onLogout: () => void
  onMenuChange?: (menu: AdminMenuId) => void
}

const menus: Array<{
  id: AdminMenuId
  label: string
  desc: string
  icon: ComponentType<{ className?: string }>
  disabled?: boolean
}> = [
  { id: 'overview', label: '总览', desc: '数据概览', icon: LayoutDashboard, disabled: true },
  { id: 'feedback', label: '意见反馈', desc: '用户反馈与 trace', icon: MessageSquareText },
  { id: 'benchmark', label: '数据集评测', desc: 'Benchmark 数据集与算法评测', icon: FlaskConical },
  { id: 'packaged-foods', label: '包装食品', desc: '待接入独立页面', icon: Package, disabled: true },
  { id: 'feed-reports', label: '举报管理', desc: '用户举报受理', icon: Flag },
  { id: 'settings', label: '系统设置', desc: '待配置', icon: Settings, disabled: true },
]

/** 后台左侧导航 */
export function AdminSidebar({ activeMenu, onLogout, onMenuChange }: AdminSidebarProps) {
  return (
    <aside className='sticky top-4 flex h-[calc(100vh-2rem)] w-[276px] shrink-0 flex-col rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
      <div className='pb-5'>
        <BrandMark />
        <p className='mt-2 text-xs text-muted-foreground'>Admin Console</p>
      </div>

      <nav className='flex flex-1 flex-col gap-1.5'>
        {menus.map((menu) => {
          const Icon = menu.icon
          const active = activeMenu === menu.id
          return (
            <button
              key={menu.id}
              type='button'
              disabled={menu.disabled}
              onClick={() => onMenuChange?.(menu.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition-colors',
                active && 'border-primary/20 bg-primary/10 text-primary',
                !active && !menu.disabled && 'hover:bg-accent',
                menu.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className='min-w-0'>
                <span className='block text-sm font-semibold'>{menu.label}</span>
                <span className='mt-0.5 block text-xs text-muted-foreground'>{menu.desc}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <Separator className='my-4' />

      <Button variant='outline' className='w-full justify-start gap-2' onClick={onLogout}>
        <LogOut className='size-4' />
        退出登录
      </Button>
    </aside>
  )
}
