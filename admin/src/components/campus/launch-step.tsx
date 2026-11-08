import { useState } from 'react'
import { toast } from 'sonner'

import { adminRequest } from '@/lib/api'
import { inviteText, sharePath } from '@/lib/campus-campaign-form'
import { LeaderPicker, type PickedUser } from '@/components/campus/leader-picker'
import { STATUS_LABELS, type CampaignRow } from '@/components/campus/types'

type LaunchStepProps = {
  campaigns: CampaignRow[]
  onChanged: () => void
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制${what}`)
  } catch {
    window.prompt(`复制${what}`, text)
  }
}

/** 第 3 步：开始活动，把加入码和说明发给社团负责人。 */
export function LaunchStep({ campaigns, onChanged }: LaunchStepProps) {
  const [busy, setBusy] = useState('')
  const [leaderFor, setLeaderFor] = useState('')

  async function setStatus(campaign: CampaignRow, status: CampaignRow['status']) {
    if (status === 'ended' && !window.confirm(`结束「${campaign.title}」？结束后成员不能再提交，核心成员的会员按原定时间到期。`)) return
    setBusy(campaign.id)
    try {
      await adminRequest(`/api/admin/campus-campaigns/${campaign.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: campaign.title, starts_at: campaign.starts_at, ends_at: campaign.ends_at, status, club_reward_note: campaign.club_reward_note }),
      })
      toast.success(status === 'active' ? '活动已开始，成员现在可以加入了；负责人的会员已开通' : '活动已结束')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy('')
    }
  }

  async function addLeaders(campaign: CampaignRow, users: PickedUser[]) {
    if (!users.length) return
    setBusy(campaign.id)
    try {
      for (const user of users) {
        await adminRequest(`/api/admin/campus-campaigns/${campaign.id}/leaders`, { method: 'POST', body: JSON.stringify({ user_id: user.user_id }) })
      }
      toast.success(`已设 ${users.map((user) => user.nickname).join('、')} 为负责人`)
      setLeaderFor('')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置负责人失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className='space-y-4 rounded-2xl border bg-card/90 p-5 shadow-sm'>
      <h2 className='text-base font-semibold'>第 3 步 · 开始活动，把加入码发给社团</h2>
      {campaigns.length === 0 ? <p className='text-sm text-muted-foreground'>还没有活动，先在第 2 步建一个。</p> : null}
      {campaigns.map((campaign) => (
        <div key={campaign.id} className='space-y-3 rounded-xl border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <p className='font-medium'>{campaign.title}</p>
              <p className='text-xs text-muted-foreground'>{campaign.school_name} · {campaign.org_name} · {campaign.starts_at.slice(0, 10)} → {campaign.ends_at.slice(0, 10)}</p>
              <p className='mt-1 text-xs'>
                <span className={campaign.status === 'active' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}>{STATUS_LABELS[campaign.status]}</span>
                {campaign.status === 'active' && !campaign.open ? '（还没到开始时间或已过结束时间）' : ''}
                {' · '}{campaign.member_count} 人加入 · {campaign.approved_count} 份称重通过
              </p>
            </div>
            <div className='flex gap-2'>
              {campaign.status !== 'active' ? (
                <button type='button' className='rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50' disabled={busy === campaign.id}
                  onClick={() => void setStatus(campaign, 'active')}>开始活动</button>
              ) : (
                <button type='button' className='rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50' disabled={busy === campaign.id}
                  onClick={() => void setStatus(campaign, 'ended')}>结束</button>
              )}
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span>加入码 <span className='font-mono text-base font-semibold'>{campaign.join_code}</span></span>
            <button type='button' className='rounded-lg border px-2 py-1 text-xs' onClick={() => void copy(inviteText(campaign, campaign.core_member_cap ?? 15), '给社团的说明')}>复制给社团的说明</button>
            <button type='button' className='rounded-lg border px-2 py-1 text-xs' onClick={() => void copy(sharePath(campaign.join_code), '小程序页面路径')}>复制页面路径（做小程序码用）</button>
            <button type='button' className='rounded-lg border px-2 py-1 text-xs' onClick={() => setLeaderFor(leaderFor === campaign.id ? '' : campaign.id)}>加负责人</button>
          </div>
          {leaderFor === campaign.id ? <LeaderPicker compact picked={[]} onChange={(users) => void addLeaders(campaign, users)} /> : null}
        </div>
      ))}
    </section>
  )
}
