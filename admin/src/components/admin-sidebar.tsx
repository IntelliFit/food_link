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
    <aside className='sticky top-4 flex h-[calc(100vh-2rem)] w-[256px] shrink-0 flex-col rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md'>
      <div className='mb-8'>
        <BrandMark />
        <p className='mt-3 text-xs text-muted-foreground'>Admin Console</p>
      </div>

      <nav className='flex flex-1 flex-col gap-3'>
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
                'flex w-full items-center justify-start gap-4 rounded-xl border border-transparent px-5 py-4 text-left transition-colors !justify-start',
                active && 'border-primary/20 bg-primary/10 text-primary',
                !active && !menu.disabled && 'hover:bg-accent',
                menu.disabled && 'cursor-not-allowed opacity-50',
              )}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            >
              <Icon className={cn('size-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className='min-w-0 text-left'>
                <span className='block text-left text-sm font-semibold'>{menu.label}</span>
                <span className='mt-1 block text-left text-xs text-muted-foreground'>{menu.desc}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <Separator className='my-8' />

      <Button variant='outline' className='h-12 w-full justify-start gap-4 px-5' onClick={onLogout}>
        <LogOut className='size-5' />
        退出登录
      </Button>
    </aside>
  )
}
