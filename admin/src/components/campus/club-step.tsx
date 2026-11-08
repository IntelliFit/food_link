import { useState } from 'react'
import { toast } from 'sonner'

import { adminRequest } from '@/lib/api'
import { findSameClub } from '@/lib/campus-campaign-form'
import type { ClubView, SchoolOption } from '@/components/campus/types'

type ClubStepProps = {
  clubs: ClubView[]
  onCreated: (club: ClubView) => void
  onUseClub: (club: ClubView) => void
  onDeleted: () => void
}

const inputClass = 'h-10 w-full rounded-xl border bg-background px-3 text-sm'

/** 第 1 步：选学校、建社团。同一所学校的同一个社团只建一次。 */
export function ClubStep({ clubs, onCreated, onUseClub, onDeleted }: ClubStepProps) {
  const [query, setQuery] = useState('')
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [school, setSchool] = useState<SchoolOption | null>(null)
  const [name, setName] = useState('')
  const [agreement, setAgreement] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<ClubView | null>(null)

  async function searchSchools() {
    if (!query.trim()) return
    try {
      const data = await adminRequest<{ items: SchoolOption[] }>(`/api/admin/campus-directory/schools?q=${encodeURIComponent(query.trim())}&status=active&limit=20`)
      setSchools(data.items || [])
      if (!data.items?.length) toast.info('没搜到这所学校，换个写法试试（如"清华"）')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索学校失败')
    }
  }

  // The club just created here is confirmed below, not offered as "already exists".
  const schoolClubs = school ? clubs.filter((club) => club.school_id === school.id && club.id !== created?.id) : []
  const same = school ? findSameClub(clubs, school.id, school.name, name) : undefined
  const canCreate = Boolean(school && name.trim() && !same && !busy)

  async function create() {
    if (!school || !canCreate) return
    setBusy(true)
    try {
      const data = await adminRequest<{ item: { id: string; name: string } }>('/api/admin/campus-orgs', {
        method: 'POST', body: JSON.stringify({ school_id: school.id, name: name.trim(), agreement_version: agreement.trim() }),
      })
      const club: ClubView = { id: data.item.id, school_id: school.id, school_name: school.name, name: data.item.name, status: 'active', agreement_version: agreement.trim(), campaign_count: 0 }
      toast.success(`社团「${club.name}」已创建`)
      setCreated(club)
      setName('')
      onCreated(club)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建社团失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(club: ClubView) {
    if (!window.confirm(`删除「${club.school_name} · ${club.name}」？只有没建过活动的社团能删。`)) return
    try {
      await adminRequest(`/api/admin/campus-orgs/${club.id}`, { method: 'DELETE' })
      toast.success('已删除')
      if (created?.id === club.id) setCreated(null)
      onDeleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <section className='space-y-4 rounded-2xl border bg-card/90 p-5 shadow-sm'>
      <h2 className='text-base font-semibold'>第 1 步 · 选学校，建社团</h2>

      <div className='space-y-2'>
        <p className='text-sm text-muted-foreground'>① 搜学校，在结果里点一下选中</p>
        {school ? (
          <div className='flex items-center gap-3 rounded-xl border border-primary bg-primary/10 px-3 py-2 text-sm'>
            <span className='font-medium'>✓ 已选学校：{school.name}{school.city ? ` · ${school.city}` : ''}</span>
            <button type='button' className='text-xs text-muted-foreground underline' onClick={() => { setSchool(null); setCreated(null) }}>换一所</button>
          </div>
        ) : (
          <>
            <div className='flex gap-2'>
              <input className={inputClass} value={query} placeholder='如 清华、北京大学' onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void searchSchools() }} />
              <button type='button' className='primary h-10 shrink-0 px-4 text-sm' onClick={() => void searchSchools()}>搜索</button>
            </div>
            {schools.length ? (
              <div className='space-y-2'>
                <p className='text-xs text-muted-foreground'>搜到 {schools.length} 所，点一下选中：</p>
                {schools.map((option) => {
                  const pick = () => { setSchool(option); setSchools([]); setCreated(null) }
                  return (
                    <div key={option.id} role='button' tabIndex={0} className='flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:border-primary hover:bg-primary/5'
                      onClick={pick} onKeyDown={(event) => { if (event.key === 'Enter') pick() }}>
                      <span className='font-medium'>{option.name}{option.city ? <span className='ml-2 text-xs font-normal text-muted-foreground'>{option.city}</span> : null}</span>
                      <span className='rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'>选这所</span>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </>
        )}
      </div>

      {school && schoolClubs.length ? (
        <div className='space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'>
          <p>{school.name}已经有社团了，一般不用再建，直接用它去第 2 步：</p>
          {schoolClubs.map((club) => (
            <div key={club.id} className='flex items-center justify-between gap-3'>
              <span>{club.name}（{club.campaign_count} 个活动）</span>
              <button type='button' className='primary px-3 text-xs' onClick={() => onUseClub(club)}>用这个社团</button>
            </div>
          ))}
        </div>
      ) : null}

      {school ? (
        <div className='space-y-2'>
          <p className='text-sm text-muted-foreground'>② 填社团名称，点创建</p>
          <input className={inputClass} value={name} placeholder={`如 ${school.name}健身协会`} onChange={(event) => setName(event.target.value)} />
          <input className={inputClass} value={agreement} placeholder='合作确认书版本（签了再填，可空），如 V1.2' onChange={(event) => setAgreement(event.target.value)} />
          {same ? (
            <p className='text-sm text-amber-700 dark:text-amber-300'>
              {same.id === created?.id ? `「${same.name}」刚刚建好了，直接去第 2 步建活动。` : `「${same.name}」已经建过了，不用再建，点上面的「用这个社团」。`}
            </p>
          ) : null}
          <button type='button' className='primary px-4 text-sm font-medium disabled:opacity-40' disabled={!canCreate} onClick={() => void create()}>
            {busy ? '创建中…' : '创建社团'}
          </button>
        </div>
      ) : null}

      {created ? (
        <p className='rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'>
          ✓ 已创建「{created.name}」，第 2 步已经帮你选好了这个社团。
        </p>
      ) : null}

      <details className='text-sm'>
        <summary className='cursor-pointer text-muted-foreground'>所有社团（{clubs.length}）</summary>
        <table className='mt-2 w-full'>
          <thead className='text-left text-xs text-muted-foreground'><tr><th className='py-1'>学校</th><th>社团</th><th>活动数</th><th /></tr></thead>
          <tbody>
            {clubs.map((club) => (
              <tr key={club.id} className='border-t'>
                <td className='py-2'>{club.school_name}</td>
                <td>{club.name}</td>
                <td>{club.campaign_count}</td>
                <td className='text-right'>
                  <button type='button' className='mr-2 text-xs text-primary' onClick={() => onUseClub(club)}>用它建活动</button>
                  {club.campaign_count === 0 ? <button type='button' className='text-xs text-red-600' onClick={() => void remove(club)}>删除</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
