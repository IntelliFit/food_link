import { useState } from 'react'
import { toast } from 'sonner'

import { adminRequest } from '@/lib/api'
import { campaignInputFromForm, type CampaignForm } from '@/lib/campus-campaign-form'
import { LeaderPicker, type PickedUser } from '@/components/campus/leader-picker'
import type { ClubView } from '@/components/campus/types'

type CampaignStepProps = {
  clubs: ClubView[]
  form: CampaignForm
  onFormChange: (patch: Partial<CampaignForm>) => void
  onCreated: () => void
}

const inputClass = 'mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm'

/** 第 2 步：给社团建一期活动，选好负责人。建出来是草稿，第 3 步再开始。 */
export function CampaignStep({ clubs, form, onFormChange, onCreated }: CampaignStepProps) {
  const [leaders, setLeaders] = useState<PickedUser[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const setPicked = (users: PickedUser[]) => {
    setLeaders(users)
    onFormChange({ leaders: users.map((user) => user.user_id).join(',') })
  }

  async function create() {
    const input = campaignInputFromForm(form)
    if ('error' in input) {
      toast.error(input.error)
      return
    }
    if (input.leader_user_ids.length === 0 && !window.confirm('还没选负责人。没有负责人就没人能勾核心成员、建称重日，确定先不选吗？')) return
    setBusy(true)
    try {
      await adminRequest('/api/admin/campus-campaigns', { method: 'POST', body: JSON.stringify(input) })
      toast.success('活动已建好（草稿）')
      setDone(`「${input.title}」已建好，现在是草稿。到第 3 步点「开始」，成员才能加入。`)
      setPicked([])
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建活动失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='space-y-4 rounded-2xl border bg-card/90 p-5 shadow-sm'>
      <h2 className='text-base font-semibold'>第 2 步 · 建活动，选负责人</h2>
      <label className='block text-sm'>社团
        <select className={inputClass} value={form.orgId} onChange={(event) => onFormChange({ orgId: event.target.value })}>
          <option value=''>{clubs.length ? '选择社团' : '还没有社团，先在第 1 步建一个'}</option>
          {clubs.map((club) => <option key={club.id} value={club.id}>{club.school_name} · {club.name}</option>)}
        </select>
      </label>
      <label className='block text-sm'>活动名称<input className={inputClass} value={form.title} placeholder='如 秋季食堂称重月' onChange={(event) => onFormChange({ title: event.target.value })} /></label>
      <div className='grid grid-cols-2 gap-3'>
        <label className='block text-sm'>开始（北京时间）<input type='datetime-local' className={inputClass} value={form.startsAt} onChange={(event) => onFormChange({ startsAt: event.target.value })} /></label>
        <label className='block text-sm'>结束（北京时间）<input type='datetime-local' className={inputClass} value={form.endsAt} onChange={(event) => onFormChange({ endsAt: event.target.value })} /></label>
      </div>
      <div className='space-y-1 text-sm'>
        <p>负责人（社长或活动负责人）</p>
        <p className='text-xs text-muted-foreground'>负责人在小程序里勾核心成员、建称重日。对方要先在小程序登录一次才能搜到。</p>
        <LeaderPicker picked={leaders} onChange={setPicked} />
      </div>
      <label className='block text-sm'>核心成员名额<input className={inputClass} value={form.coreCap} onChange={(event) => onFormChange({ coreCap: event.target.value })} />
        <span className='text-xs text-muted-foreground'>核心成员活动期间免费用标准版（含精准模式），默认 15 人</span>
      </label>
      <label className='block text-sm'>社团自设奖励说明（可空，会显示在活动页）<input className={inputClass} value={form.rewardNote} onChange={(event) => onFormChange({ rewardNote: event.target.value })} /></label>
      <details className='text-sm'>
        <summary className='cursor-pointer text-muted-foreground'>高级设置</summary>
        <label className='mt-2 block'>核心成员会员套餐编码<input className={inputClass} value={form.planCode} onChange={(event) => onFormChange({ planCode: event.target.value })} /></label>
      </details>
      <button type='button' className='primary px-4 text-sm font-medium disabled:opacity-40' disabled={busy || !form.orgId} onClick={() => void create()}>
        {busy ? '创建中…' : '建活动'}
      </button>
      {done ? <p className='rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'>✓ {done}</p> : null}
    </section>
  )
}
