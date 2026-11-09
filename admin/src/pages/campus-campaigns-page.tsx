import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { CampaignStep } from '@/components/campus/campaign-step'
import { ClubStep } from '@/components/campus/club-step'
import { LaunchStep } from '@/components/campus/launch-step'
import type { CampaignRow, ClubView } from '@/components/campus/types'
import { adminRequest } from '@/lib/api'
import { defaultCampaignForm, type CampaignForm } from '@/lib/campus-campaign-form'

type PageProps = { onLogout: () => void; onMenuChange: (menu: AdminMenuId) => void }

const GUIDE = [
  { title: '建社团', desc: '搜学校、点选，填社团名。一个学校的同一个社团只建一次。' },
  { title: '建活动', desc: '选社团、时间，搜出社长设为负责人。建出来是草稿。' },
  { title: '开始并发给社团', desc: '点「开始活动」，再点「复制给社团的说明」发给社长。' },
]

/** 高校伙伴计划：三步建好一个社团活动，之后社团在小程序里自己跑。 */
export function CampusCampaignsPage({ onLogout, onMenuChange }: PageProps) {
  const [clubs, setClubs] = useState<ClubView[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [form, setForm] = useState<CampaignForm>(() => defaultCampaignForm())

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const [clubData, campaignData] = await Promise.all([
        adminRequest<{ items: ClubView[] }>('/api/admin/campus-orgs'),
        adminRequest<{ items: CampaignRow[] }>('/api/admin/campus-campaigns'),
      ])
      const loadedClubs = clubData.items || []
      setClubs(loadedClubs)
      setCampaigns(campaignData.items || [])
      // With a single club there is nothing to choose in step 2.
      if (loadedClubs.length === 1) setForm((current) => (current.orgId ? current : { ...current, orgId: loadedClubs[0].id }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取高校伙伴计划失败')
    }
  }

  const useClub = (club: ClubView) => {
    setForm((current) => ({ ...current, orgId: club.id }))
    document.getElementById('campus-step-2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toast.success(`第 2 步已选「${club.school_name} · ${club.name}」`)
  }

  const done = [clubs.length > 0, campaigns.length > 0, campaigns.some((campaign) => campaign.status === 'active')]

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='campus-campaigns' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <section className='space-y-3'>
          <p className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>Campus Channel</p>
          <h1 className='text-2xl font-semibold tracking-tight'>高校伙伴计划</h1>
          <p className='text-sm text-muted-foreground'>我们只做这三步；之后核心成员、称重日由社团负责人在小程序里自己管，称重样本自动审核。</p>
          <ol className='grid gap-3 md:grid-cols-3'>
            {GUIDE.map((step, index) => (
              <li key={step.title} className={`rounded-2xl border p-4 ${done[index] ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-card/90'}`}>
                <p className='text-sm font-semibold'>{done[index] ? '✓ ' : `${index + 1}. `}{step.title}</p>
                <p className='mt-1 text-xs text-muted-foreground'>{step.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <ClubStep
          clubs={clubs}
          onCreated={(club) => { setClubs((current) => [club, ...current]); setForm((current) => ({ ...current, orgId: club.id })); void load() }}
          onUseClub={useClub}
          onDeleted={() => { setForm((current) => ({ ...current, orgId: '' })); void load() }}
        />
        <div id='campus-step-2'>
          <CampaignStep clubs={clubs} form={form} onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onCreated={() => { setForm((current) => defaultCampaignForm(Date.now(), current.orgId)); void load() }} />
        </div>
        <LaunchStep campaigns={campaigns} onChanged={() => void load()} />
      </main>
    </div>
  )
}
