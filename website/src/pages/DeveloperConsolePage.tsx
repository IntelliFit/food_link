import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, LogOut, Plus, RefreshCw, WalletCards } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { Button } from '@/components/ui/button'
import { type CreditPackage, type DeveloperApp, developerApi, getDeveloperToken, loginWithSMS, sendSMSCode, setDeveloperToken, type PaymentOrder } from '@/lib/developer-api'

function fieldClass() { return 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15' }

export function DeveloperConsolePage() {
  const [token, setToken] = useState(getDeveloperToken())
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [apps, setApps] = useState<DeveloperApp[]>([])
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [appName, setAppName] = useState('')
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [payment, setPayment] = useState<PaymentOrder | null>(null)
  const [ledgerByApp, setLedgerByApp] = useState<Record<string, Awaited<ReturnType<typeof developerApi.listLedger>>['entries']>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!getDeveloperToken()) return
    const [appData, packageData] = await Promise.all([developerApi.listApps(), developerApi.listPackages()])
    setApps(appData.apps)
    setPackages(packageData.packages)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, token])
  useEffect(() => { if (cooldown <= 0) return; const id = window.setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000); return () => window.clearInterval(id) }, [cooldown])
  useEffect(() => {
    if (!payment || payment.status !== 'pending') return
    const id = window.setInterval(async () => {
      try { const next = await developerApi.syncPayment(payment.order_no); setPayment((current) => current ? { ...current, ...next } : next); if (next.status === 'paid') await load() } catch { /* retain QR and retry */ }
    }, 3000)
    return () => window.clearInterval(id)
  }, [payment, load])

  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) } }

  if (!token) return <div className="min-h-screen bg-gradient-page"><main className="mx-auto flex min-h-[85vh] max-w-md items-center px-4 py-12"><div className="w-full rounded-3xl border border-border bg-card p-6 shadow-xl md:p-8"><Link to="/developer" className="text-sm text-primary">← 返回开放平台</Link><h1 className="mt-6 text-2xl font-bold">登录开发者控制台</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">使用食探手机号短信验证码登录；首次登录会自动创建账号。</p>{error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<div className="mt-6 flex flex-col gap-3"><input aria-label="手机号" className={fieldClass()} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="中国大陆手机号" inputMode="tel" /><div className="flex gap-2"><input aria-label="验证码" className={fieldClass()} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" /><Button variant="outline" className="h-11 shrink-0" disabled={cooldown > 0 || busy || phone.length !== 11} onClick={() => run(async () => { const data = await sendSMSCode(phone); setCooldown(data.cooldown_seconds || 60) })}>{cooldown ? `${cooldown}s` : '获取验证码'}</Button></div><Button className="h-11" disabled={busy || code.length < 4} onClick={() => run(async () => { await loginWithSMS(phone, code); setToken(getDeveloperToken()) })}>登录 / 注册</Button></div></div></main><SiteFooter /></div>

  return <div className="min-h-screen bg-gradient-page"><header className="border-b border-border bg-background/90 backdrop-blur"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8"><Link to="/developer" className="font-bold">食探开放平台</Link><Button variant="ghost" onClick={() => { setDeveloperToken(''); setToken('') }}><LogOut />退出</Button></div></header><main className="mx-auto max-w-6xl px-4 py-10 md:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">开发者控制台</h1><p className="mt-2 text-sm text-muted-foreground">应用、密钥、点数与支付订单</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" render={<a href="/downloads/foodlink-mcp-latest.zip" download />}><Download />下载 MCP</Button><Button variant="outline" onClick={() => run(load)} disabled={busy}><RefreshCw />刷新</Button></div></div>{error && <p role="alert" className="mt-6 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

    <section className="mt-8 rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">新建应用</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">每个开发者账号仅第一个应用赠送 100 点；后续应用从 0 点开始。每个账号最多创建 5 个应用。</p><div className="mt-4 flex max-w-lg gap-2"><input aria-label="应用名称" className={fieldClass()} value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="例如：我的饮食 Agent" /><Button className="h-11" disabled={busy || appName.trim().length < 2} onClick={() => run(async () => { const created = await developerApi.createApp(appName); setSecret(created.secret); setAppName(''); await load() })}><Plus />创建</Button></div></section>

    {secret && <section className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-5"><h2 className="font-semibold">请立即保存 API Key</h2><p className="mt-1 text-sm text-muted-foreground">出于安全原因，完整密钥只展示这一次。不要放入网页前端或设备固件。</p><div className="mt-4 flex items-center gap-2 rounded-xl bg-background p-3"><code className="min-w-0 flex-1 overflow-x-auto text-sm">{secret}</code><Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(secret); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制'}</Button></div><div className="mt-4 flex flex-wrap gap-2"><Button render={<a href="/downloads/foodlink-mcp-latest.zip" download />}><Download />下一步：下载 MCP</Button><Button variant="outline" render={<a href="/developer/ai-guide.md" />}>把接入交给 AI</Button></div></section>}

    <div className="mt-8 grid gap-6">{apps.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">还没有应用，先创建一个。</div> : apps.map((app) => <article key={app.id} className="rounded-2xl border border-border bg-card p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{app.name}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{app.id}</p></div><div className="rounded-xl bg-primary/10 px-4 py-3 text-right"><p className="text-xs text-muted-foreground">API 点数余额</p><p className="text-2xl font-bold text-primary">{app.balance_units}</p></div></div><div className="mt-6"><div className="flex items-center justify-between"><h3 className="font-medium">API Keys</h3><Button size="sm" variant="outline" onClick={() => run(async () => { const created = await developerApi.createKey(app.id, `密钥 ${new Date().toLocaleDateString()}`); setSecret(created.secret); await load() })}><KeyRound />新建密钥</Button></div><div className="mt-3 divide-y divide-border rounded-xl border border-border">{app.keys?.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><span className="font-medium">{key.name}</span><code className="ml-2 text-muted-foreground">{key.key_prefix}…</code><span className="ml-2 text-xs text-muted-foreground">{key.status}</span></div>{key.status === 'active' && <Button size="sm" variant="destructive" onClick={() => run(async () => { await developerApi.revokeKey(app.id, key.id); await load() })}>吊销</Button>}</div>)}</div></div>
      <div className="mt-6"><h3 className="flex items-center gap-2 font-medium"><WalletCards />充值点数</h3>{packages.length === 0 ? <p className="mt-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">Beta 套餐尚未启用。当前可联系食探团队人工发放测试点数。</p> : <div className="mt-3 grid gap-3 sm:grid-cols-3">{packages.map((item) => <button key={item.code} className="rounded-xl border border-border p-4 text-left transition hover:border-primary" onClick={() => run(async () => setPayment(await developerApi.createPayment(app.id, item.code)))}><strong>{item.name}</strong><p className="mt-1 text-sm text-muted-foreground">{item.units} 点</p><p className="mt-3 text-lg font-bold">¥{(item.amount_fen / 100).toFixed(2)}</p></button>)}</div>}</div>
      <div className="mt-6 border-t border-border pt-5"><div className="flex items-center justify-between"><h3 className="font-medium">点数流水</h3><Button size="sm" variant="ghost" onClick={() => run(async () => { const data = await developerApi.listLedger(app.id); setLedgerByApp((current) => ({ ...current, [app.id]: data.entries })) })}>查看最近流水</Button></div>{ledgerByApp[app.id] && <div className="mt-3 divide-y divide-border rounded-xl border border-border">{ledgerByApp[app.id].length === 0 ? <p className="p-4 text-sm text-muted-foreground">暂无流水</p> : ledgerByApp[app.id].map((entry) => <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-3 p-3 text-sm"><div><p>{entry.description}</p><p className="mt-1 text-xs text-muted-foreground">{entry.created_at ? new Date(entry.created_at).toLocaleString() : entry.entry_type}</p></div><div className="text-right"><p className={entry.delta_units > 0 ? 'font-semibold text-primary' : 'font-semibold'}>{entry.delta_units > 0 ? '+' : ''}{entry.delta_units}</p><p className="text-xs text-muted-foreground">余额 {entry.balance_after}</p></div></div>)}</div>}</div></article>)}</div>

    {payment && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-sm rounded-3xl bg-background p-6 text-center shadow-2xl"><h2 className="text-xl font-bold">微信扫码充值</h2><p className="mt-2 text-sm text-muted-foreground">订单 {payment.order_no}</p>{payment.status === 'paid' ? <div className="my-8"><Check className="mx-auto size-14 text-primary" /><p className="mt-3 font-semibold">支付成功，点数已到账</p></div> : <div className="mx-auto my-6 w-fit rounded-2xl border bg-white p-3">{(payment.qr_code_value || payment.code_url) && <QRCodeSVG value={payment.qr_code_value || payment.code_url || ''} size={220} />}</div>}<p className="text-sm">¥{(payment.amount_fen / 100).toFixed(2)} · {payment.units} 点</p><Button className="mt-5 w-full" variant={payment.status === 'paid' ? 'default' : 'outline'} onClick={() => setPayment(null)}>{payment.status === 'paid' ? '完成' : '稍后支付'}</Button></div></div>}
  </main><SiteFooter /></div>
}
