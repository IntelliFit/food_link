import { useState } from 'react'

import { ActionDialog, type ActionSpec } from '@/components/action-dialog'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Button } from '@/components/ui/button'
import { PromoterListSection } from '@/pages/promoter-list-section'
import { PromoterWithdrawalsSection } from '@/pages/promoter-withdrawals-section'

type PromotersPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type Tab = 'withdrawals' | 'promoters'

/** 推广佣金：推广员审核、提现审核与人工打款、佣金扣回 */
export function PromotersPage({ onLogout, onMenuChange }: PromotersPageProps) {
  const [tab, setTab] = useState<Tab>('withdrawals')
  const [action, setAction] = useState<ActionSpec | null>(null)

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='promoters' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>推广佣金</h1>
            <p className='text-sm text-muted-foreground'>审核推广员和提现。现阶段提现由运营在商户平台或微信转账后手工标记，微信商家转账接入后改为自动打款。</p>
          </div>
          <div className='flex gap-2'>
            <Button variant={tab === 'withdrawals' ? 'default' : 'outline'} onClick={() => setTab('withdrawals')}>提现审核</Button>
            <Button variant={tab === 'promoters' ? 'default' : 'outline'} onClick={() => setTab('promoters')}>推广员</Button>
          </div>
        </div>

        {tab === 'withdrawals'
          ? <PromoterWithdrawalsSection onAction={setAction} />
          : <PromoterListSection onAction={setAction} />}
      </main>
      <ActionDialog spec={action} onClose={() => setAction(null)} />
    </div>
  )
}
