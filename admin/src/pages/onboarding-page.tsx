import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, RefreshCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminRequest } from '@/lib/api'

type BadgeIcon = 'shield' | 'school' | 'data' | 'star'
type Badge = { icon: BadgeIcon; text: string }
type TrustConfig = {
  badges: Badge[]
  source_lines: string[]
  result_line: string
  guest_try_per_install_daily: number
  guest_try_global_daily: number
}
type Variant = { key: string; weight: number }
type Experiment = {
  key: string
  description: string
  status: 'draft' | 'running' | 'stopped'
  audience: 'all' | 'new_users'
  variants: Variant[]
  salt: string
  override_variant?: string
  started_at?: string
  ended_at?: string
}
type VariantSummary = {
  variant: string
  assigned: number
  excluded: number
  exposed: number
  exposed_logged_in: number
  matured_24h: number
  matured_48h: number
  ai_within_24h: number
  record_within_24h: number
  record_on_second_day: number
}

const iconLabels: Record<BadgeIcon, string> = { shield: '盾牌', school: '学校', data: '数据', star: '星标' }
const statusLabels = { draft: '草稿', running: '进行中', stopped: '已结束' }
const onboardingDraft: Experiment = {
  key: 'onboarding_v2',
  description: '注册新流程：小麦带着走、先试后登、3 句话建档。对照组为原流程。',
  status: 'draft',
  audience: 'new_users',
  variants: [{ key: 'control', weight: 50 }, { key: 'pet_flow', weight: 50 }],
  salt: 'onboarding_v2',
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}

export function OnboardingPage({ onLogout, onMenuChange }: {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}) {
  const [config, setConfig] = useState<TrustConfig | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [selected, setSelected] = useState('')
  const [summary, setSummary] = useState<VariantSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [cfg, list] = await Promise.all([
        adminRequest<{ config: TrustConfig }>('/onboarding/config'),
        adminRequest<{ items: Experiment[] }>('/experiments'),
      ])
      setConfig(cfg.config)
      setExperiments(list.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败')
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  useEffect(() => {
    if (!selected) { setSummary([]); return }
    adminRequest<{ variants: VariantSummary[] }>(`/experiments/${selected}/summary`)
      .then(res => setSummary(res.variants || []))
      .catch(err => toast.error(err instanceof Error ? err.message : '读取实验数据失败'))
  }, [selected])

  async function saveConfig(event: FormEvent) {
    event.preventDefault()
    if (!config || busy) return
    setBusy(true)
    try {
      const res = await adminRequest<{ config: TrustConfig; warnings: string[] | null }>('/onboarding/config', {
        method: 'PUT', body: JSON.stringify(config),
      })
      setConfig(res.config)
      setWarnings(res.warnings || [])
      toast.success(res.warnings?.length ? '已保存，请看下方提醒' : '已保存，小程序下次打开引导页时生效')
    } catch (err) { toast.error(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function saveExperiment(exp: Experiment, patch: Partial<Experiment>, confirmText?: string) {
    if (busy) return
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    try {
      const next = { ...exp, ...patch }
      await adminRequest(`/experiments/${next.key}`, {
        method: 'PUT',
        body: JSON.stringify({
          description: next.description,
          status: next.status,
          audience: next.audience,
          variants: next.variants,
          salt: next.salt,
          override_variant: next.override_variant ?? '',
        }),
      })
      toast.success('实验已更新')
      await reload()
    } catch (err) { toast.error(err instanceof Error ? err.message : '实验更新失败') }
    finally { setBusy(false) }
  }

  function setBadge(index: number, patch: Partial<Badge>) {
    if (!config) return
    setConfig({ ...config, badges: config.badges.map((b, i) => (i === index ? { ...b, ...patch } : b)) })
  }

  const hasOnboarding = experiments.some(e => e.key === onboardingDraft.key)

  return (
    <div className='relative z-10 mx-auto flex max-w-[1600px] gap-6 p-4 lg:p-6'>
      <AdminSidebar activeMenu='onboarding' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 flex-1 space-y-6'>
        <header className='flex items-start justify-between gap-4'>
          <div>
            <h1 className='flex items-center gap-2 text-2xl font-bold'><Sparkles className='size-6' />注册引导与实验</h1>
            <p className='mt-2 text-sm text-muted-foreground'>新注册流程（onboarding_v2 实验组）里的信任徽章、说明文字和游客体验次数；以及 A/B 实验的开关和数据。</p>
          </div>
          <Button variant='outline' disabled={loading || busy} onClick={() => void reload()}><RefreshCcw className='size-4' />刷新</Button>
        </header>

        {loading ? <div className='flex justify-center p-10'><Loader2 className='size-6 animate-spin' aria-label='读取中' /></div> : error ? (
          <div className='rounded-xl border p-5 text-destructive'>{error}<Button variant='outline' className='ml-3' onClick={() => void reload()}>重试</Button></div>
        ) : (
          <div className='grid items-start gap-6 xl:grid-cols-2'>
            {config && (
              <section className='rounded-xl border bg-card p-5'>
                <h2 className='mb-4 flex items-center gap-2 font-semibold'><ShieldCheck className='size-5' />信任徽章与说明</h2>
                <form className='space-y-5' onSubmit={saveConfig}>
                  <div className='space-y-3'>
                    <p className='text-sm'>徽章（最多 3 个，每个最多 16 字，留空即不显示）</p>
                    {[0, 1, 2].map(i => {
                      const badge = config.badges[i] || { icon: 'shield' as BadgeIcon, text: '' }
                      return (
                        <div key={i} className='flex gap-2'>
                          <select aria-label={`徽章 ${i + 1} 图标`} className='rounded-md border bg-background px-2 text-sm' value={badge.icon} disabled={busy}
                            onChange={e => {
                              const badges = [...config.badges]
                              while (badges.length <= i) badges.push({ icon: 'shield', text: '' })
                              badges[i] = { ...badges[i], icon: e.target.value as BadgeIcon }
                              setConfig({ ...config, badges })
                            }}>
                            {(Object.keys(iconLabels) as BadgeIcon[]).map(k => <option key={k} value={k}>{iconLabels[k]}</option>)}
                          </select>
                          <Input aria-label={`徽章 ${i + 1} 文字`} maxLength={16} value={badge.text} disabled={busy} placeholder='例如：识别精准度业内领先'
                            onChange={e => {
                              if (i < config.badges.length) { setBadge(i, { text: e.target.value }); return }
                              const badges = [...config.badges]
                              while (badges.length < i) badges.push({ icon: 'shield', text: '' })
                              badges.push({ icon: badge.icon, text: e.target.value })
                              setConfig({ ...config, badges })
                            }} />
                        </div>
                      )
                    })}
                  </div>
                  <label className='block space-y-2 text-sm'>
                    <span>「数据从哪来」里的补充说明（每行一条，最多 6 条，每条 80 字内；数据量那几条由系统实时统计，不用写）</span>
                    <textarea rows={4} disabled={busy} className='w-full rounded-md border bg-background p-3 text-sm'
                      value={config.source_lines.join('\n')}
                      placeholder={'精准度：XX 基准（2026-10）中热量误差 X%，在 N 个同类产品里排名第 N\n与清华大学 XX 实验室合作'}
                      onChange={e => setConfig({ ...config, source_lines: e.target.value.split('\n') })} />
                  </label>
                  <label className='block space-y-2 text-sm'>
                    <span>识别结果合计下方的一行（40 字内，留空不显示）</span>
                    <Input maxLength={40} disabled={busy} value={config.result_line} placeholder='例如：识别精准度业内领先 · 内测热量误差 X%'
                      onChange={e => setConfig({ ...config, result_line: e.target.value })} />
                  </label>
                  <div className='grid grid-cols-2 gap-3'>
                    <label className='block space-y-2 text-sm'>
                      <span>游客每台设备每天体验次数</span>
                      <Input type='number' min={0} max={20} disabled={busy} value={config.guest_try_per_install_daily}
                        onChange={e => setConfig({ ...config, guest_try_per_install_daily: Number(e.target.value) })} />
                    </label>
                    <label className='block space-y-2 text-sm'>
                      <span>全站游客每天体验总次数</span>
                      <Input type='number' min={0} max={10000} disabled={busy} value={config.guest_try_global_daily}
                        onChange={e => setConfig({ ...config, guest_try_global_daily: Number(e.target.value) })} />
                    </label>
                  </div>
                  <p className='text-xs text-muted-foreground'>每次游客体验都会调用一次识别模型（含纠错），按次计费。</p>
                  <div className='rounded-lg border bg-muted/30 p-4'>
                    <p className='text-xs text-muted-foreground'>徽章预览</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {config.badges.filter(b => b.text.trim()).map((b, i) => (
                        <span key={i} className='rounded-full bg-[#123B2C] px-3 py-1 text-xs font-semibold text-[#F6E7B8]'>{b.text}</span>
                      ))}
                    </div>
                  </div>
                  {warnings.length > 0 && (
                    <ul className='space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'>
                      {warnings.map(w => <li key={w}>· {w}</li>)}
                    </ul>
                  )}
                  <p className='text-xs text-muted-foreground'>上线前请准备好支撑材料：精准度对应的测试报告；使用合作方名称需对方书面同意。「第一」「最」等绝对化用语受《广告法》第九条限制。</p>
                  <Button type='submit' disabled={busy}>{busy && <Loader2 className='size-4 animate-spin' />}保存</Button>
                </form>
              </section>
            )}

            <section className='space-y-4 rounded-xl border bg-card p-5'>
              <div className='flex items-center justify-between'>
                <h2 className='font-semibold'>A/B 实验</h2>
                {!hasOnboarding && (
                  <Button variant='outline' disabled={busy} onClick={() => void saveExperiment(onboardingDraft, {})}>创建 onboarding_v2 草稿</Button>
                )}
              </div>
              {experiments.length === 0 ? <p className='text-sm text-muted-foreground'>还没有实验。</p> : experiments.map(exp => (
                <article key={exp.key} className='space-y-3 rounded-lg border p-4'>
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <h3 className='font-semibold'>{exp.key}</h3>
                      <p className='mt-1 text-sm text-muted-foreground'>{exp.description}</p>
                    </div>
                    <span className='shrink-0 rounded bg-muted px-2 py-1 text-xs'>{statusLabels[exp.status]}{exp.override_variant ? ` · 强制 ${exp.override_variant}` : ''}</span>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    人群：{exp.audience === 'new_users' ? '仅新用户' : '全部'} · 分组：{exp.variants.map(v => `${v.key} ${v.weight}`).join(' / ')}
                    {exp.started_at ? ` · 开始 ${new Date(exp.started_at).toLocaleString('zh-CN')}` : ''}
                    {exp.ended_at ? ` · 结束 ${new Date(exp.ended_at).toLocaleString('zh-CN')}` : ''}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {exp.status === 'draft' && <Button disabled={busy} onClick={() => void saveExperiment(exp, { status: 'running' }, `开始实验 ${exp.key}？开始后分组种子、人群和分组列表都不能再改，只能调权重。`)}>开始实验</Button>}
                    {exp.status === 'running' && !exp.override_variant && exp.variants.map(v => (
                      <Button key={v.key} variant='outline' disabled={busy} onClick={() => void saveExperiment(exp, { override_variant: v.key }, `所有人立刻都看 ${v.key}，新用户不再计入实验。确定？`)}>全部切到 {v.key}</Button>
                    ))}
                    {exp.override_variant && exp.status === 'running' && <Button variant='outline' disabled={busy} onClick={() => void saveExperiment(exp, { override_variant: '' }, '取消强制分组，恢复按比例分组？')}>取消强制</Button>}
                    {exp.status === 'running' && <Button variant='outline' disabled={busy} onClick={() => void saveExperiment(exp, { status: 'stopped' }, `结束实验 ${exp.key}？结束后不能重新开始。`)}>结束实验</Button>}
                    <Button variant='ghost' disabled={busy} onClick={() => setSelected(selected === exp.key ? '' : exp.key)}>{selected === exp.key ? '收起数据' : '看数据'}</Button>
                  </div>
                  {selected === exp.key && (
                    <div className='overflow-x-auto'>
                      <table className='w-full text-left text-sm'>
                        <thead className='text-xs text-muted-foreground'>
                          <tr><th className='py-2 pr-3'>分组</th><th className='pr-3'>分到</th><th className='pr-3'>排除</th><th className='pr-3'>曝光</th><th className='pr-3'>登录</th><th className='pr-3'>24h 用 AI</th><th className='pr-3'>24h 记录</th><th>次日记录</th></tr>
                        </thead>
                        <tbody>
                          {summary.length === 0 ? <tr><td colSpan={8} className='py-3 text-muted-foreground'>还没有数据</td></tr> : summary.map(row => (
                            <tr key={row.variant} className='border-t'>
                              <td className='py-2 pr-3 font-medium'>{row.variant}</td>
                              <td className='pr-3'>{row.assigned}</td>
                              <td className='pr-3'>{row.excluded}</td>
                              <td className='pr-3'>{row.exposed}</td>
                              <td className='pr-3'>{row.exposed_logged_in}（{pct(row.exposed_logged_in, row.exposed)}）</td>
                              <td className='pr-3'>{row.ai_within_24h}（{pct(row.ai_within_24h, row.matured_24h)}）</td>
                              <td className='pr-3'>{row.record_within_24h}（{pct(row.record_within_24h, row.matured_24h)}）</td>
                              <td>{row.record_on_second_day}（{pct(row.record_on_second_day, row.matured_48h)}）</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className='mt-2 text-xs text-muted-foreground'>百分比的分母只算窗口已走完的人（24h / 48h），刚进组的人不计入。</p>
                    </div>
                  )}
                </article>
              ))}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
