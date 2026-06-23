import type { ComponentType } from 'react'
import {
  Activity,
  Apple,
  CreditCard,
  Flag,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Package,
  Settings,
  Utensils,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand-mark'
import { ThemeToggle } from '@/components/theme-toggle'

export type AdminMenuId = 'overview' | 'feedback' | 'benchmark' | 'packaged-foods' | 'food-nutrition' | 'public-food-library' | 'exercise-energy' | 'feed-reports' | 'payment-test' | 'settings'

type AdminSidebarProps = {
  activeMenu: AdminMenuId
  onLogout: () => void
  onMenuChange?: (menu: AdminMenuId) => void
}

type AdminMenuItem = {
  id: AdminMenuId
  label: string
  icon: ComponentType<{ className?: string }>
  disabled?: boolean
}

const menuGroups: Array<{
  label: string
  items: AdminMenuItem[]
}> = [
  {
    label: '工作台',
    items: [
      { id: 'overview', label: '总览', icon: LayoutDashboard },
    ],
  },
  {
    label: '用户声音',
    items: [
      { id: 'feedback', label: '意见反馈', icon: MessageSquareText },
      { id: 'feed-reports', label: '举报管理', icon: Flag },
    ],
  },
  {
    label: '内容数据',
    items: [
      { id: 'packaged-foods', label: '包装食品', icon: Package },
      { id: 'food-nutrition', label: '营养食物', icon: Apple },
      { id: 'public-food-library', label: '公共食物', icon: Utensils },
      { id: 'exercise-energy', label: '运动库', icon: Activity },
    ],
  },
  {
    label: '实验工具',
    items: [
      { id: 'benchmark', label: '数据集评测', icon: FlaskConical },
      { id: 'payment-test', label: '支付测试', icon: CreditCard },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'settings', label: '系统设置', icon: Settings, disabled: true },
    ],
  },
]

/** 后台左侧导航 */
export function AdminSidebar({ activeMenu, onLogout, onMenuChange }: AdminSidebarProps) {
  return (
    <aside className='sticky top-4 flex h-[calc(100vh-2rem)] w-[256px] shrink-0 flex-col rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
      <div className='mb-6 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <BrandMark />
          <p className='mt-3 text-xs text-muted-foreground'>Admin Console</p>
        </div>
        <ThemeToggle />
      </div>

      <nav className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1'>
        {menuGroups.map((group) => (
          <section key={group.label} className='space-y-2'>
            <div className='px-2 text-[11px] font-semibold tracking-wide text-muted-foreground'>
              {group.label}
            </div>
            <div className='space-y-1'>
              {group.items.map((menu) => {
                const Icon = menu.icon
                const active = activeMenu === menu.id
                return (
                  <button
                    key={menu.id}
                    type='button'
                    disabled={menu.disabled}
                    onClick={() => onMenuChange?.(menu.id)}
                    className={cn(
                      'flex w-full items-center justify-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                      active && 'border-primary/20 bg-primary/10 text-primary',
                      !active && !menu.disabled && 'hover:bg-accent',
                      menu.disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                    <span className='min-w-0 text-left text-sm font-semibold'>{menu.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </nav>

      <Separator className='my-5' />

      <Button variant='outline' className='h-11 w-full justify-start gap-3 px-3 text-left' onClick={onLogout}>
        <LogOut className='size-4' />
        退出登录
      </Button>
    </aside>
  )
}
