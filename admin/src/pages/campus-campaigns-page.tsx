import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest } from '@/lib/api'
import { campaignInputFromForm, emptyCampaignForm, sharePath, type CampaignForm } from '@/lib/campus-campaign-form'

type PageProps = { onLogout: () => void; onMenuChange: (menu: AdminMenuId) => void }

type Org = { id: string; school_id: string; name: string; status: string; agreement_version: string; created_at?: string }
type Campaign = {
  id: string; title: string; join_code: string; status: 'draft' | 'active' | 'ended'; open: boolean
  starts_at: string; ends_at: string; school_name: string; org_name: string; member_count: number; approved_count: number
  club_reward_note: string
}
type School = { id: string; name: string; city?: string }

const STATUS_LABELS: Record<Campaign['status'], string> = { draft: '草稿', active: '进行中', ended: '已结束' }

export function CampusCampaignsPage({ onLogout, onMenuChange }: PageProps) {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [schoolQuery, setSchoolQuery] = useState('')
  const [schools, setSchools] = useState<School[]>([])
  const [orgSchool, setOrgSchool] = useState<School | null>(null)
  const [orgName, setOrgName] = useState('')
  const [agreement, setAgreement] = useState('')
  const [form, setForm] = useState<CampaignForm>(emptyCampaignForm())
  const [leaderInput, setLeaderInput] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const [orgData, campaignData] = await Promise.all([
        adminRequest<{ items: Org[] }>('/api/admin/campus-orgs'),
        adminRequest<{ items: Campaign[] }>('/api/admin/campus-campaigns'),
      ])
      setOrgs(orgData.items || [])
      setCampaigns(campaignData.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取高校共建失败')
    }
  }

  async function searchSchools() {
    if (!schoolQuery.trim()) return
    try {
      const data = await adminRequest<{ items: School[] }>(`/api/admin/campus-directory/schools?q=${encodeURIComponent(schoolQuery.trim())}&status=active&limit=20`)
      setSchools(data.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索学校失败')
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const createOrg = () => {
    if (!orgSchool || !orgName.trim()) {
      toast.error('先选学校并填社团名称')
      return
    }
    void run(() => adminRequest('/api/admin/campus-orgs', {
      method: 'POST', body: JSON.stringify({ school_id: orgSchool.id, name: orgName.trim(), agreement_version: agreement.trim() }),
    }), '社团已创建').then(() => setOrgName(''))
  }

  const createCampaign = () => {
    const input = campaignInputFromForm(form)
    if ('error' in input) {
      toast.error(input.error)
      return
    }
    void run(() => adminRequest('/api/admin/campus-campaigns', { method: 'POST', body: JSON.stringify(input) }), '活动已创建')
      .then(() => setForm(emptyCampaignForm()))
  }

  const setStatus = (campaign: Campaign, status: Campaign['status']) => void run(() => adminRequest(`/api/admin/campus-campaigns/${campaign.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: campaign.title, starts_at: campaign.starts_at, ends_at: campaign.ends_at, status, club_reward_note: campaign.club_reward_note }),
  }), status === 'active' ? '活动已开始，成员可以加入' : '已更新')

  const addLeader = (campaign: Campaign) => {
    const userId = (leaderInput[campaign.id] || '').trim()
    if (!userId) return
    void run(() => adminRequest(`/api/admin/campus-campaigns/${campaign.id}/leaders`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }), '已设为负责人')
      .then(() => setLeaderInput((current) => ({ ...current, [campaign.id]: '' })))
  }

  const update = (patch: Partial<CampaignForm>) => setForm((current) => ({ ...current, ...patch }))
  const inputClass = 'mt-2 h-10 w-full rounded-xl border bg-background px-3'

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='campus-campaigns' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <section className='space-y-2'>
          <p className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>Campus Channel</p>
          <h1 className='text-2xl font-semibold tracking-tight'>高校共建</h1>
          <p className='text-sm text-muted-foreground'>每个社团建一次、每期建一个活动并指定负责人；之后核心成员、称重日都由负责人在小程序里自己管。样本自动审核。</p>
        </section>

        <section className='grid gap-6 lg:grid-cols-2'>
          <div className='space-y-3 rounded-2xl border bg-card/90 p-5 shadow-sm'>
            <h2 className='text-sm font-semibold'>新建社团</h2>
            <div className='flex gap-2'>
              <input className={inputClass} value={schoolQuery} placeholder='搜学校，如 清华' onChange={(event) => setSchoolQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void searchSchools() }} />
              <button className='mt-2 h-10 rounded-xl border px-4 text-sm' onClick={() => void searchSchools()}>搜索</button>
            </div>
            <div className='flex flex-wrap gap-2'>
              {schools.map((school) => (
                <button key={school.id} className={`rounded-full border px-3 py-1 text-xs ${orgSchool?.id === school.id ? 'border-primary bg-primary/10' : ''}`} onClick={() => setOrgSchool(school)}>
                  {school.name}{school.city ? ` · ${school.city}` : ''}
                </button>
              ))}
            </div>
            <label className='block text-sm'>社团名称<input className={inputClass} value={orgName} placeholder='如 清华大学健身协会' onChange={(event) => setOrgName(event.target.value)} /></label>
            <label className='block text-sm'>合作确认书版本（签了再填）<input className={inputClass} value={agreement} placeholder='如 V1.2' onChange={(event) => setAgreement(event.target.value)} /></label>
            <button className='rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50' disabled={busy} onClick={createOrg}>创建社团</button>
          </div>

          <div className='space-y-3 rounded-2xl border bg-card/90 p-5 shadow-sm'>
            <h2 className='text-sm font-semibold'>新建活动</h2>
            <label className='block text-sm'>社团
              <select className={inputClass} value={form.orgId} onChange={(event) => update({ orgId: event.target.value })}>
                <option value=''>选择社团</option>
                {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </label>
            <label className='block text-sm'>活动名称<input className={inputClass} value={form.title} placeholder='如 秋季食堂称重月' onChange={(event) => update({ title: event.target.value })} /></label>
            <div className='grid grid-cols-2 gap-3'>
              <label className='block text-sm'>开始<input type='datetime-local' className={inputClass} value={form.startsAt} onChange={(event) => update({ startsAt: event.target.value })} /></label>
              <label className='block text-sm'>结束<input type='datetime-local' className={inputClass} value={form.endsAt} onChange={(event) => update({ endsAt: event.target.value })} /></label>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <label className='block text-sm'>核心成员名额<input className={inputClass} value={form.coreCap} onChange={(event) => update({ coreCap: event.target.value })} /></label>
              <label className='block text-sm'>会员套餐编码<input className={inputClass} value={form.planCode} onChange={(event) => update({ planCode: event.target.value })} /></label>
            </div>
            <label className='block text-sm'>负责人用户 ID（多个用逗号分隔）<input className={inputClass} value={form.leaders} placeholder='小程序账号的用户 ID' onChange={(event) => update({ leaders: event.target.value })} /></label>
            <label className='block text-sm'>社团自设奖励说明（可空）<input className={inputClass} value={form.rewardNote} onChange={(event) => update({ rewardNote: event.target.value })} /></label>
            <button className='rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50' disabled={busy} onClick={createCampaign}>创建活动（草稿）</button>
          </div>
        </section>

        <section className='rounded-2xl border bg-card/90 p-5 shadow-sm'>
          <h2 className='text-sm font-semibold'>活动</h2>
          <table className='mt-3 w-full text-sm'>
            <thead className='text-left text-muted-foreground'>
              <tr><th className='py-2'>学校 / 社团</th><th>活动</th><th>时间</th><th>加入码</th><th>成员</th><th>通过样本</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className='border-t align-top'>
                  <td className='py-3'>{campaign.school_name}<div className='text-xs text-muted-foreground'>{campaign.org_name}</div></td>
                  <td className='py-3'>{campaign.title}</td>
                  <td className='py-3 text-xs'>{campaign.starts_at.slice(0, 10)} → {campaign.ends_at.slice(0, 10)}</td>
                  <td className='py-3 font-mono'>{campaign.join_code}<div className='text-xs text-muted-foreground'>{sharePath(campaign.join_code)}</div></td>
                  <td className='py-3'>{campaign.member_count}</td>
                  <td className='py-3'>{campaign.approved_count}</td>
                  <td className='py-3'>{STATUS_LABELS[campaign.status]}{campaign.status === 'active' && !campaign.open ? '（不在时间内）' : ''}</td>
                  <td className='space-y-2 py-3'>
                    <div className='flex gap-2'>
                      {campaign.status !== 'active' ? <button className='rounded-lg border px-2 py-1 text-xs' disabled={busy} onClick={() => setStatus(campaign, 'active')}>开始</button> : null}
                      {campaign.status === 'active' ? <button className='rounded-lg border px-2 py-1 text-xs' disabled={busy} onClick={() => setStatus(campaign, 'ended')}>结束</button> : null}
                    </div>
                    <div className='flex gap-2'>
                      <input className='h-8 w-44 rounded-lg border bg-background px-2 text-xs' value={leaderInput[campaign.id] || ''} placeholder='负责人用户 ID'
                        onChange={(event) => setLeaderInput((current) => ({ ...current, [campaign.id]: event.target.value }))} />
                      <button className='rounded-lg border px-2 text-xs' disabled={busy} onClick={() => addLeader(campaign)}>设负责人</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {campaigns.length === 0 ? <p className='py-6 text-center text-sm text-muted-foreground'>还没有活动</p> : null}
        </section>
      </main>
    </div>
  )
}
