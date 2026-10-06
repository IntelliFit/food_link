import { useEffect, useState } from 'react'
import { Activity, CreditCard, RefreshCw, Users } from 'lucide-react'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Button } from '@/components/ui/button'
import { adminRequest } from '@/lib/api'

type Day = { day: string; dau: number | null; mau: number | null; paying_users: number; updated_at: string }
type Overview = { today: Day; period_paying_users: number; total_paying_users: number; active_paid_members: number; days: Day[]; updated_at: string; collection_started_at: string }
const number = (n: number | null | undefined) => n == null ? '未采集' : n.toLocaleString('zh-CN')
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

export function AnalyticsPage({ onLogout, onMenuChange }: { onLogout: () => void; onMenuChange: (menu: AdminMenuId) => void }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let disposed = false
    let pending = false
    const controller = new AbortController()
    async function load() {
      if (document.hidden || pending) return
      pending = true
      setLoading(true)
      try {
        const result = await adminRequest<Overview>(`/api/admin/analytics?days=${days}`, { signal: controller.signal })
        if (!disposed) { setData(result); setError('') }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '读取数据失败')
      } finally {
        pending = false
        if (!disposed) setLoading(false)
      }
    }
    setData(null)
    void load()
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [days, refresh])

  const cards = [
    { title: '今日活跃用户', value: data?.today.dau, note: 'DAU · 今日暂计', icon: Activity },
    { title: '近 30 天活跃用户', value: data?.today.mau, note: 'MAU · 跨日去重', icon: Users },
    { title: `近 ${days} 天付费用户`, value: data?.period_paying_users, note: '成功支付用户去重', icon: CreditCard },
    { title: '当前有效付费会员', value: data?.active_paid_members, note: '有效付费周期内', icon: Users },
  ]
  return (
    <div className='relative z-10 mx-auto flex w-full max-w-[1540px] gap-6 px-4 py-4'>
      <div className='hidden lg:block'><AdminSidebar activeMenu='analytics' onLogout={onLogout} onMenuChange={onMenuChange} /></div>
      <main className='min-w-0 flex-1 space-y-6 pb-8'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div><p className='text-sm text-muted-foreground'>智健食探 · 运营数据</p><h1 className='text-3xl font-bold'>用户与付费趋势</h1><p className='mt-2 text-sm text-muted-foreground'>{data ? `数据截至 ${dateTime(data.updated_at)}（北京时间）` : '北京时间统计'}</p></div>
          <div className='flex flex-wrap gap-2'>
            {[7, 30, 90].map(n => <Button key={n} variant={days === n ? 'default' : 'outline'} onClick={() => setDays(n)} aria-pressed={days === n}>近 {n} 天</Button>)}
            <Button variant='outline' disabled={loading} onClick={() => setRefresh(n => n + 1)} aria-label='刷新数据'><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button>
            <Button variant='outline' className='lg:hidden' onClick={onLogout}>退出</Button>
          </div>
        </header>
        {error && <div role='alert' className='rounded-xl border border-destructive/40 p-4 text-destructive'>更新失败：{error}。已有数据可能过期，请重试。</div>}
        <section className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {cards.map(card => <article key={card.title} className='rounded-2xl border bg-card p-5 shadow-sm'><div className='flex items-center justify-between text-muted-foreground'><span className='text-sm'>{card.title}</span><card.icon className='size-5' /></div>{!data && loading ? <div className='my-4 h-9 w-24 animate-pulse rounded bg-muted' aria-label='正在获取指标' /> : <p className='my-3 text-3xl font-bold'>{data ? number(card.value) : '—'}</p>}<p className='text-xs text-muted-foreground'>{card.note}</p></article>)}
        </section>
        {data && <>
          <div className='grid gap-6 xl:grid-cols-2'>
            <Trend title='活跃用户趋势' rows={data.days} series={[{ key: 'dau', label: '日活 DAU', color: '#0891b2' }, { key: 'mau', label: '月活 MAU', color: '#8b5cf6' }]} />
            <Trend title='每日付费用户趋势' rows={data.days} series={[{ key: 'paying_users', label: '付费用户', color: '#10b981' }]} />
          </div>
          <section className='rounded-2xl border bg-card p-5'>
            <h2 className='text-lg font-semibold'>每日明细</h2><p className='mt-1 text-sm text-muted-foreground'>累计净付费用户：{number(data.total_paying_users)}。每日付费人数不能相加作为期间去重人数。</p>
            <div className='mt-4 max-h-[460px] overflow-auto'><table className='w-full text-left text-sm'><thead className='sticky top-0 bg-card'><tr>{['日期', '日活 DAU', '月活 MAU', '付费人数'].map(label => <th key={label} className='border-b p-3'>{label}</th>)}</tr></thead><tbody>{[...data.days].reverse().map(row => <tr key={row.day} className='border-b last:border-0'><td className='p-3'>{row.day}{row.day === data.today.day ? '（暂计）' : ''}</td><td className='p-3'>{number(row.dau)}</td><td className='p-3'>{number(row.mau)}</td><td className='p-3'>{number(row.paying_users)}</td></tr>)}</tbody></table></div>
          </section>
          <section className='rounded-2xl border bg-card p-5 text-sm leading-7 text-muted-foreground'>
            <h2 className='font-semibold text-foreground'>统计口径与更新</h2>
            <p>活跃采集始于 {dateTime(data.collection_started_at)}。以成功读取首页、个人资料、饮食列表等页面接口的登录用户为活跃，App 与小程序同账号去重；该指标是前台使用的接口代理口径，不包含离线使用。后台轮询与支付测试账号不计入。</p>
            <p>历史完整日按北京时间结算；采集首日不完整，历史 DAU 留空。MAU 需完整覆盖最近 30 天，覆盖不足显示“未采集”。今日 DAU 为暂计。</p>
            <p>付费仅统计人民币会员产品的正金额成功订单，排除测试账号与测试套餐、免费及赠送权益；全额退款后从净付费人数扣除，退款前的历史日仍保留。有效付费会员按当前有效付费周期统计，不包含单独赠送的会员。</p>
            <p>当前指标缓存 5 分钟，页面可见时每 5 分钟刷新；历史每天凌晨结算，并重算最近 7 天。未获取到数据或更新失败时不会用零值代替。</p>
          </section>
        </>}
      </main>
    </div>
  )
}

type Series = { key: 'dau' | 'mau' | 'paying_users'; label: string; color: string }
function Trend({ title, rows, series }: { title: string; rows: Day[]; series: Series[] }) {
  const max = Math.max(1, ...rows.flatMap(row => series.map(s => row[s.key] ?? 0)))
  const x = (i: number) => 48 + i * 620 / Math.max(1, rows.length - 1)
  const y = (n: number) => 220 - n * 180 / max
  const available = rows.some(row => series.some(s => row[s.key] != null))
  return <section className='rounded-2xl border bg-card p-5'><h2 className='text-lg font-semibold'>{title}</h2><div className='my-3 flex flex-wrap gap-4 text-sm'>{series.map(s => <span key={s.key} className='flex items-center gap-2'><i className='size-2 rounded-full' style={{ backgroundColor: s.color }} />{s.label}</span>)}</div>{!available ? <p className='py-20 text-center text-muted-foreground'>所选期间尚无完整采集数据</p> : <svg viewBox='0 0 700 270' className='w-full' role='img' aria-label={`${title}，准确数值见下方每日明细`}>
    {[0, 0.5, 1].map(t => <g key={t}><line x1='48' x2='668' y1={y(max * t)} y2={y(max * t)} stroke='currentColor' opacity='.12' /><text x='40' y={y(max * t) + 4} textAnchor='end' fill='currentColor' fontSize='11'>{Math.round(max * t)}</text></g>)}
    {series.map(s => { let path = ''; let gap = true; rows.forEach((row, i) => { const n = row[s.key]; if (n == null) { gap = true; return }; path += `${gap ? 'M' : 'L'}${x(i)},${y(n)} `; gap = false }); return <g key={s.key}><path d={path} fill='none' stroke={s.color} strokeWidth='2.5' />{rows.map((row, i) => row[s.key] == null ? null : <circle key={row.day} cx={x(i)} cy={y(row[s.key]!)} r='3' fill={s.color}><title>{row.day} · {s.label}：{row[s.key]}</title></circle>)}</g> })}
    <text x='48' y='253' fill='currentColor' fontSize='12'>{rows[0]?.day}</text><text x='668' y='253' textAnchor='end' fill='currentColor' fontSize='12'>{rows.at(-1)?.day}</text>
  </svg>}</section>
}
