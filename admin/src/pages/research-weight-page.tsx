import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest } from '@/lib/api'

type ResearchWeightPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type SampleItem = {
  name: string
  cumulative_reading_grams: number
  grams: number
  contains_bone: boolean
  contains_soup: boolean
}

type SamplePhoto = {
  role: string
  object_key: string
  url: string
  item_index?: number
  captured_at?: string
}

type Sample = {
  id: string
  user_id: string
  scene: string
  weighing_mode: 'whole' | 'itemized'
  dish_name: string
  venue_name: string
  city: string
  container_type: string
  tare_mode: string
  tare_grams: number
  gross_reading_grams?: number
  total_net_grams: number
  scale_precision_grams: number
  items: SampleItem[]
  photos: SamplePhoto[]
  reference_object: string
  video_url?: string
  device: Record<string, string>
  notes: string
  status: 'pending' | 'approved' | 'rejected'
  quality_tier?: string
  review_note: string
  reward_credits: number
  rewarded_at?: string
  benchmark_sample_id?: string
  created_at?: string
}

type ListResponse = { items: Sample[]; total: number; page: number; limit: number }

const ROLE_LABELS: Record<string, string> = {
  tare_scale: '皮重读数', gross_scale: '总读数', item_scale: '分项读数',
  eval_top: '俯拍', eval_angle: '45°', eval_top_ref: '俯拍+参照物', eval_angle_ref: '45°+参照物',
}
const EVIDENCE_ROLES = new Set(['tare_scale', 'gross_scale', 'item_scale'])
const SCENE_LABELS: Record<string, string> = { canteen: '食堂', home: '家里', takeout: '外卖', restaurant: '餐馆', other: '其他' }

export function ResearchWeightPage({ onLogout, onMenuChange }: ResearchWeightPageProps) {
  const [status, setStatus] = useState('pending')
  const [mode, setMode] = useState('')
  const [scene, setScene] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Sample[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Sample | null>(null)
  const [tier, setTier] = useState('B')
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  const [batchName, setBatchName] = useState('')
  const [acting, setActing] = useState(false)
  const limit = 40

  useEffect(() => {
    void loadList(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, mode, scene])

  useEffect(() => {
    setNote(selected?.review_note || '')
    setCredits(selected ? String(selected.weighing_mode === 'itemized' ? 4 : 2) : '')
  }, [selected?.id])

  function listParams(nextPage: number, pageLimit: number) {
    const params = new URLSearchParams({ page: String(nextPage), limit: String(pageLimit), status })
    if (mode) params.set('weighing_mode', mode)
    if (scene) params.set('scene', scene)
    if (query.trim()) params.set('q', query.trim())
    return params
  }

  async function loadList(nextPage = page) {
    try {
      const data = await adminRequest<ListResponse>(`/api/admin/research-weight-samples?${listParams(nextPage, limit)}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
      setSelected((current) => data.items.find((item) => item.id === current?.id) || data.items[0] || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取称重样本失败')
    }
  }

  async function act(path: string, body: Record<string, unknown>, success: string) {
    if (!selected) return
    setActing(true)
    try {
      const data = await adminRequest<{ item: Sample }>(`/api/admin/research-weight-samples/${encodeURIComponent(selected.id)}/${path}`, {
        method: 'POST', body: JSON.stringify(body),
      })
      toast.success(success)
      setSelected(data.item)
      await loadList(page)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setActing(false)
    }
  }

  function review(action: 'approve' | 'reject') {
    const body: Record<string, unknown> = { action, review_note: note }
    if (action === 'approve') {
      body.quality_tier = tier
      if (credits.trim() !== '') body.reward_credits = Number(credits)
    }
    void act('review', body, action === 'approve' ? '已通过' : '已驳回')
  }

  async function exportApproved() {
    try {
      const rows: Sample[] = []
      for (let nextPage = 1; nextPage <= 20; nextPage += 1) {
        const params = new URLSearchParams({ page: String(nextPage), limit: '500', status: 'approved' })
        const data = await adminRequest<ListResponse>(`/api/admin/research-weight-samples?${params}`)
        rows.push(...(data.items || []))
        if (rows.length >= data.total || !data.items?.length) break
      }
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `research-weight-approved-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(link.href)
      toast.success(`已导出 ${rows.length} 条`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  const evidence = selected?.photos.filter((photo) => EVIDENCE_ROLES.has(photo.role)) || []
  const evaluation = selected?.photos.filter((photo) => !EVIDENCE_ROLES.has(photo.role)) || []

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='research-weight' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <section className='flex items-end justify-between gap-4'>
          <div className='space-y-2'>
            <p className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>Weight Benchmark</p>
            <h1 className='text-2xl font-semibold tracking-tight'>称重科研数据</h1>
            <p className='text-sm text-muted-foreground'>审核用户上传的食物秤读数与评测照片；通过后可加入数据集评测。克重由服务端按读数计算。</p>
          </div>
          <button className='h-10 rounded-xl border px-4 text-sm font-medium' onClick={() => void exportApproved()}>导出已通过 JSON</button>
        </section>

        <section className='flex flex-wrap items-end gap-3 rounded-2xl border bg-card/90 p-4 shadow-sm'>
          <label className='min-w-[240px] flex-1 text-sm'>
            搜索
            <input className='mt-2 h-10 w-full rounded-xl border bg-background px-3' value={query} placeholder='菜名、地点、备注'
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); void loadList(1) } }} />
          </label>
          <Select label='状态' value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={[['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回'], ['all', '全部']]} />
          <Select label='方式' value={mode} onChange={(value) => { setMode(value); setPage(1) }} options={[['', '全部'], ['whole', '整份'], ['itemized', '分项']]} />
          <Select label='场景' value={scene} onChange={(value) => { setScene(value); setPage(1) }} options={[['', '全部'], ...Object.entries(SCENE_LABELS)]} />
          <div className='text-sm text-muted-foreground'>共 {total} 条</div>
        </section>

        <section className='grid min-h-[640px] gap-6 lg:grid-cols-[340px_minmax(0,1fr)]'>
          <div className='space-y-3 rounded-2xl border bg-card/90 p-3 shadow-sm'>
            {items.map((item) => (
              <button key={item.id} type='button' onClick={() => setSelected(item)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === item.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'}`}>
                <div className='flex items-center justify-between gap-3'>
                  <span className='truncate text-sm font-semibold'>{item.dish_name}</span>
                  <span className='text-xs text-muted-foreground'>{item.total_net_grams}g</span>
                </div>
                <div className='mt-1 text-xs text-muted-foreground'>
                  {SCENE_LABELS[item.scene] || item.scene} · {item.weighing_mode === 'itemized' ? `分项${item.items.length}项` : '整份'} · {item.status}{item.quality_tier ? ` ${item.quality_tier}` : ''}
                </div>
              </button>
            ))}
            <div className='flex justify-between px-1 pt-2 text-sm'>
              <button disabled={page <= 1} className='disabled:opacity-40' onClick={() => setPage(page - 1)}>上一页</button>
              <button disabled={page * limit >= total} className='disabled:opacity-40' onClick={() => setPage(page + 1)}>下一页</button>
            </div>
          </div>

          <div className='rounded-2xl border bg-card/90 p-5 shadow-sm'>
            {!selected ? <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>请选择一条样本。</div> : (
              <div className='space-y-6'>
                <section className='grid gap-4 md:grid-cols-2'>
                  <InfoCard title='样本'>
                    <InfoRow label='菜名' value={selected.dish_name} />
                    <InfoRow label='地点' value={[selected.venue_name, selected.city].filter(Boolean).join(' · ') || '--'} />
                    <InfoRow label='场景 / 容器' value={`${SCENE_LABELS[selected.scene] || selected.scene} / ${selected.container_type}`} />
                    <InfoRow label='设备' value={[selected.device?.brand, selected.device?.model].filter(Boolean).join(' ') || '--'} />
                    <InfoRow label='提交时间' value={selected.created_at ? new Date(selected.created_at).toLocaleString() : '--'} />
                    <InfoRow label='备注' value={selected.notes || '--'} />
                  </InfoCard>
                  <InfoCard title='称重（服务端计算）'>
                    <InfoRow label='去皮' value={selected.tare_mode === 'zeroed' ? '秤已归零' : `${selected.tare_grams}g`} />
                    {selected.gross_reading_grams != null ? <InfoRow label='连容器读数' value={`${selected.gross_reading_grams}g`} /> : null}
                    <InfoRow label='净重' value={`${selected.total_net_grams}g`} />
                    <InfoRow label='秤精度' value={`${selected.scale_precision_grams}g`} />
                    <InfoRow label='参照物' value={selected.reference_object} />
                    <InfoRow label='评测集样本' value={selected.benchmark_sample_id || '未加入'} mono />
                  </InfoCard>
                </section>

                {selected.items.length ? (
                  <table className='w-full overflow-hidden rounded-2xl border text-sm'>
                    <thead className='bg-muted/60 text-left'><tr><th className='px-3 py-2'>#</th><th className='px-3 py-2'>名称</th><th className='px-3 py-2'>累计读数</th><th className='px-3 py-2'>本项</th><th className='px-3 py-2'>标记</th></tr></thead>
                    <tbody>
                      {selected.items.map((item, index) => (
                        <tr key={index} className='border-t'>
                          <td className='px-3 py-2'>{index + 1}</td><td className='px-3 py-2'>{item.name}</td>
                          <td className='px-3 py-2'>{item.cumulative_reading_grams}g</td><td className='px-3 py-2 font-medium'>{item.grams}g</td>
                          <td className='px-3 py-2 text-muted-foreground'>{[item.contains_bone && '含骨', item.contains_soup && '含汤'].filter(Boolean).join(' ') || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                <PhotoGroup title='读数证据（核对与填写读数是否一致）' photos={evidence} items={selected.items} />
                <PhotoGroup title='评测照片（照片里不应出现秤读数）' photos={evaluation} items={selected.items} />
                {selected.video_url ? <video className='max-h-72 rounded-xl border' src={selected.video_url} controls /> : null}

                {selected.status === 'pending' ? (
                  <section className='space-y-3 rounded-2xl border p-4'>
                    <h2 className='text-sm font-semibold'>审核</h2>
                    <div className='flex flex-wrap gap-3'>
                      <Select label='等级' value={tier} onChange={setTier} options={[['A', 'A 金标'], ['B', 'B 银标'], ['C', 'C 铜标']]} />
                      <label className='text-sm'>奖励积分<input className='mt-2 h-10 w-24 rounded-xl border bg-background px-3' value={credits} onChange={(event) => setCredits(event.target.value)} /></label>
                    </div>
                    <textarea className='min-h-[80px] w-full rounded-xl border bg-background px-3 py-2 text-sm' value={note} placeholder='备注；驳回时必填（用户可见）' onChange={(event) => setNote(event.target.value)} />
                    <div className='flex gap-3'>
                      <button className='rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50' disabled={acting} onClick={() => review('approve')}>通过</button>
                      <button className='rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50' disabled={acting} onClick={() => review('reject')}>驳回</button>
                    </div>
                  </section>
                ) : null}

                {selected.status === 'approved' && selected.reward_credits > 0 && !selected.rewarded_at ? (
                  <section className='flex items-center justify-between gap-3 rounded-2xl border border-amber-300 p-4 text-sm'>
                    <span>已通过，但 {selected.reward_credits} 积分未发放成功。</span>
                    <button className='rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50' disabled={acting}
                      onClick={() => void act('review', { action: 'approve', quality_tier: selected.quality_tier || 'B' }, '已补发积分')}>补发积分</button>
                  </section>
                ) : null}

                {selected.status === 'approved' && !selected.benchmark_sample_id ? (
                  <section className='flex flex-wrap items-end gap-3 rounded-2xl border p-4'>
                    <label className='text-sm'>评测集批次名<input className='mt-2 h-10 w-64 rounded-xl border bg-background px-3' value={batchName} placeholder='默认 research-YYYYMM' onChange={(event) => setBatchName(event.target.value)} /></label>
                    <button className='h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50' disabled={acting}
                      onClick={() => void act('promote', { batch_name: batchName.trim() }, '已加入评测集')}>加入数据集评测</button>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function PhotoGroup({ title, photos, items }: { title: string; photos: SamplePhoto[]; items: SampleItem[] }) {
  if (!photos.length) return null
  return (
    <section className='space-y-2'>
      <h2 className='text-sm font-semibold'>{title}</h2>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        {photos.map((photo) => (
          <a key={photo.object_key} href={photo.url} target='_blank' rel='noreferrer' className='overflow-hidden rounded-xl border'>
            <img src={photo.url} alt={photo.role} className='aspect-square w-full object-cover' />
            <div className='px-2 py-1 text-xs text-muted-foreground'>
              {ROLE_LABELS[photo.role] || photo.role}
              {photo.item_index != null ? ` · 第${photo.item_index + 1}项 ${items[photo.item_index]?.name || ''} ${items[photo.item_index]?.cumulative_reading_grams ?? ''}g` : ''}
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className='text-sm'>
      {label}
      <select className='mt-2 block h-10 rounded-xl border bg-background px-3' value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className='rounded-2xl border p-4'><h2 className='text-sm font-semibold'>{title}</h2><div className='mt-3 space-y-2'>{children}</div></div>
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className='flex items-start justify-between gap-4 text-sm'><span className='shrink-0 text-muted-foreground'>{label}</span><span className={`text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span></div>
}
