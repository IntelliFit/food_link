import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, LoaderCircle, LogOut, Plus } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { APIKeySaveDialog } from '@/components/developer/APIKeySaveDialog'
import { AIHandoffCard } from '@/components/developer/AIHandoffCard'
import { CreateAPIKeyDialog } from '@/components/developer/CreateAPIKeyDialog'
import { ImportAPIKeyDialog } from '@/components/developer/ImportAPIKeyDialog'
import { type ApiKeySummary, type CreditPackage, type DeveloperApp, developerApi, getDeveloperToken, loginWithSMS, sendSMSCode, setDeveloperToken, type KeyMaterial, type PaymentOrder } from '@/lib/developer-api'

const inputClass = 'h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15'
type KeySelection = { app: DeveloperApp; apiKey: ApiKeySummary }

export function DeveloperConsolePage() {
  const [token, setToken] = useState(getDeveloperToken())
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [apps, setApps] = useState<DeveloperApp[]>([])
  const [ready, setReady] = useState(false)
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [creatingApp, setCreatingApp] = useState(false)
  const [appName, setAppName] = useState('我的饮食助手')
  const [creatingKey, setCreatingKey] = useState<DeveloperApp | null>(null)
  const [importingKey, setImportingKey] = useState<KeySelection | null>(null)
  const [keyDialog, setKeyDialog] = useState<{ material: KeyMaterial; savedBefore: boolean } | null>(null)
  // Complete credentials stay in this page's memory only, never in browser storage.
  const [sessionKeys, setSessionKeys] = useState<Record<string, KeyMaterial>>({})
  const [paymentApp, setPaymentApp] = useState<DeveloperApp | null>(null)
  const [payment, setPayment] = useState<PaymentOrder | null>(null)
  const [ledgerByApp, setLedgerByApp] = useState<Record<string, Awaited<ReturnType<typeof developerApi.listLedger>>['entries']>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const currentToken = getDeveloperToken()
    if (!currentToken) return
    const [appData, packageData] = await Promise.all([developerApi.listApps(), developerApi.listPackages().catch(() => null)])
    if (getDeveloperToken() !== currentToken) return
    setApps(appData.apps)
    setCapabilities(appData.capabilities ?? [])
    if (packageData) setPackages(packageData.packages)
    setSessionKeys((current) => Object.fromEntries(Object.entries(current).filter(([id]) => appData.apps.some((app) => app.status === 'active' && app.keys?.some((key) => key.id === id && key.status === 'active')))))
    setReady(true)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch((e: unknown) => setError(e instanceof Error ? e.message : '读取失败，请重试。')) }, 0)
    return () => window.clearTimeout(timer)
  }, [load, token])
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(id)
  }, [cooldown])
  useEffect(() => {
    if (!payment || payment.status !== 'pending') return
    const currentToken = getDeveloperToken()
    const id = window.setInterval(async () => {
      try {
        const next = await developerApi.syncPayment(payment.order_no)
        if (getDeveloperToken() !== currentToken) return
        setPayment((current) => current?.order_no === next.order_no ? { ...current, ...next } : current)
        if (next.status === 'paid') await load()
      } catch { /* Keep the current order available for a later retry. */ }
    }, 3000)
    return () => window.clearInterval(id)
  }, [payment, load])

  function logout() {
    setDeveloperToken('')
    setToken('')
    setSessionKeys({})
    setKeyDialog(null)
    setImportingKey(null)
    setCreatingKey(null)
    setCreatingApp(false)
    setPayment(null)
    setPaymentApp(null)
    setLedgerByApp({})
    setApps([])
    setReady(false)
    setError('')
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (e) {
      if (!getDeveloperToken() && token) logout()
      setError(e instanceof Error ? e.message : '操作失败，请重试。')
    } finally { setBusy(false) }
  }

  function rememberKey(material: KeyMaterial, savedBefore = false) {
    if (getDeveloperToken() !== token) return
    setSessionKeys((current) => ({ ...current, [material.api_key.id]: material }))
    setCreatingKey(null)
    setImportingKey(null)
    setKeyDialog({ material, savedBefore })
  }

  function openKey(app: DeveloperApp, apiKey: ApiKeySummary) {
    const material = sessionKeys[apiKey.id]
    if (material) setKeyDialog({ material: { ...material, app, api_key: apiKey }, savedBefore: true })
    else setImportingKey({ app, apiKey })
  }

  async function stopKey(app: DeveloperApp, apiKey: ApiKeySummary) {
    if (!window.confirm('停用这把密钥？使用它的电脑和程序将无法继续调用。')) return
    await run(async () => {
      await developerApi.revokeKey(app.id, apiKey.id)
      setSessionKeys((current) => { const next = { ...current }; delete next[apiKey.id]; return next })
      setApps((current) => current.map((item) => item.id === app.id ? { ...item, keys: item.keys?.map((key) => key.id === apiKey.id ? { ...key, status: 'revoked' } : key) } : item))
      await load()
    })
  }

  async function recycleApp(app: DeveloperApp) {
    if (!window.confirm(`将“${app.name}”移入回收站？所有密钥会停止调用，${app.balance_units} 点余额保留，恢复后才能继续用。`)) return
    await run(async () => {
      await developerApi.recycleApp(app.id)
      setSessionKeys((current) => Object.fromEntries(Object.entries(current).filter(([, material]) => material.app.id !== app.id)))
      setApps((current) => current.map((item) => item.id === app.id ? { ...item, status: 'disabled' } : item))
      await load()
    })
  }

  if (!token) return <div className="min-h-screen bg-gradient-page"><main className="mx-auto flex min-h-[85vh] max-w-md items-center px-4 py-12"><div className="w-full rounded-3xl border border-border bg-card p-6 shadow-xl md:p-8">
    <Link to="/developer" className="text-base text-primary">← 开放平台</Link><h1 className="mt-6 text-2xl font-bold">登录，获取 API 密钥</h1>
    {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-base text-destructive">{error}</p>}
    <div className="mt-6 flex flex-col gap-3"><input aria-label="手机号" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" inputMode="tel" /><div className="flex gap-2"><input aria-label="验证码" className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" inputMode="numeric" /><Button variant="outline" className="h-12 shrink-0" disabled={cooldown > 0 || busy || phone.length !== 11} onClick={() => run(async () => { const data = await sendSMSCode(phone); setCooldown(data.cooldown_seconds || 60) })}>{cooldown ? `${cooldown}s` : '获取验证码'}</Button></div><Button className="h-12" disabled={busy || code.length < 4} onClick={() => run(async () => { await loginWithSMS(phone, code); setToken(getDeveloperToken()) })}>{busy && <LoaderCircle className="animate-spin" />}登录 / 注册</Button></div>
  </div></main><SiteFooter /></div>

  const activeApps = apps.filter((app) => app.status === 'active')
  const recycledApps = apps.filter((app) => app.status === 'disabled')
  const canRecycle = capabilities.includes('app_recycle')

  return <div className="min-h-screen bg-gradient-page">
    <header className="border-b border-border bg-background/90"><div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 md:px-8"><Link to="/developer" className="font-bold">食探开放平台</Link><Button variant="ghost" disabled={busy} onClick={logout}><LogOut />退出</Button></div></header>
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">API 密钥</h1><Button variant="ghost" nativeButton={false} render={<Link to="/developer/docs" />}>使用说明</Button></div>
      {error && <div role="alert" className="mt-5 rounded-xl bg-destructive/10 p-4 text-base text-destructive">{error}<Button variant="ghost" className="ml-2" disabled={busy} onClick={() => run(load)}>重试</Button></div>}
      {!ready && !error && <div className="grid min-h-40 place-items-center"><LoaderCircle className="size-8 animate-spin text-primary" aria-label="正在读取密钥" /></div>}
      {ready && <>
        {activeApps.length === 0 && <section className="mt-6 rounded-2xl border bg-card p-8 text-center"><h2 className="text-xl font-semibold">给你的 AI 接上食探</h2><Button className="mt-5 h-12" disabled={busy} onClick={() => setCreatingApp(true)}><KeyRound />获取密钥</Button></section>}
        <div className="mt-6 grid gap-6">{activeApps.map((app) => {
          const activeKeys = app.keys?.filter((key) => key.status === 'active') ?? []
          const stoppedKeys = app.keys?.filter((key) => key.status !== 'active') ?? []
          return <article key={app.id} className="rounded-2xl border border-border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{app.name}</h2><div className="flex items-center gap-3"><span className="text-lg font-semibold text-primary">{app.balance_units} 点</span><Button variant="outline" disabled={busy} onClick={() => setPaymentApp(app)}>充值</Button></div></div>
            <div className="mt-5 divide-y rounded-xl border">{activeKeys.length === 0 ? <p className="p-4 text-base text-muted-foreground">没有可用密钥</p> : activeKeys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="text-base font-medium">{key.name}</p><code className="block max-w-full truncate text-base text-muted-foreground">{key.key_prefix}…</code></div><div className="flex gap-2"><Button disabled={busy} onClick={() => openKey(app, key)}><Copy />复制</Button><Button variant="ghost" disabled={busy} onClick={() => stopKey(app, key)}>停用</Button></div></div>)}</div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={busy || activeKeys.length >= 5} onClick={() => setCreatingKey(app)}><Plus />新建密钥</Button><details className="relative"><summary className="cursor-pointer rounded-lg px-3 py-2 text-base text-muted-foreground">管理应用</summary><div className="absolute right-0 z-10 mt-1 w-56 space-y-2 rounded-xl border bg-background p-3 shadow-lg"><Button className="w-full justify-start" variant="ghost" disabled={busy} onClick={() => run(async () => { const data = await developerApi.listLedger(app.id); setLedgerByApp((current) => ({ ...current, [app.id]: data.entries })) })}>查看用量</Button>{canRecycle && <Button className="w-full justify-start text-destructive" variant="ghost" disabled={busy} onClick={() => recycleApp(app)}>移入回收站</Button>}<details><summary className="cursor-pointer p-2 text-base">应用与权限信息</summary><div className="break-all px-2 text-base leading-7"><p>{app.id}</p>{activeKeys.map((key) => <p key={key.id}>{key.name}：{key.scopes.map((scope) => ({ 'food:analyze': '识别', 'food:search': '营养', 'records:read': '历史', 'health:read': '评分' })[scope] ?? scope).join('、')}</p>)}</div></details></div></details></div>
            {stoppedKeys.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-base text-muted-foreground">已停用密钥（{stoppedKeys.length}）</summary><div className="mt-2 space-y-2 rounded-xl bg-muted/50 p-4">{stoppedKeys.map((key) => <p key={key.id} className="text-base">{key.name} · {key.key_prefix}…</p>)}</div></details>}
            {ledgerByApp[app.id] && <details open className="mt-4"><summary className="cursor-pointer text-base">最近用量</summary><div className="mt-3 divide-y rounded-xl border">{ledgerByApp[app.id].length === 0 ? <p className="p-4 text-base">暂无用量</p> : ledgerByApp[app.id].map((entry) => <div key={entry.id} className="flex items-center justify-between gap-4 p-4 text-base"><span>{entry.description}</span><span>{entry.delta_units > 0 ? '+' : ''}{entry.delta_units} 点</span></div>)}</div></details>}
          </article>
        })}</div>
        {activeApps.length > 0 && <Button className="mt-4" variant="ghost" disabled={busy || apps.length >= 5} onClick={() => setCreatingApp(true)}><Plus />新建应用</Button>}
        {canRecycle && recycledApps.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-base">应用回收站（{recycledApps.length}）</summary><div className="mt-3 space-y-3">{recycledApps.map((app) => <div key={app.id} className="flex items-center justify-between gap-3 rounded-xl border p-4"><span>{app.name} · {app.balance_units} 点</span><Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`恢复“${app.name}”？未停用的旧密钥也会恢复调用。`)) void run(async () => { await developerApi.restoreApp(app.id); await load() }) }}>恢复</Button></div>)}</div></details>}
        <div className="mt-6"><AIHandoffCard compact /></div>
        <details className="mt-5 rounded-xl border p-4"><summary className="cursor-pointer text-base">密钥使用常见问题</summary><div className="mt-3 space-y-3 text-base leading-7"><p>点击“复制”：本页新建的密钥可重复复制；旧密钥需要先导入已保存文件。没有文件就新建一把，余额不变。</p><p>新建时选“查看我的历史”，才允许这把密钥读取你的历史记录和健康评分。仅识别食物时不需要。</p><p>完整密钥仅临时留在本页内存，不存进浏览器；刷新、退出后需重新导入。不要把密钥内容发进聊天。</p><p>普通餐照 5 点/张，文字 2 点/次；账户与营养查询免费。每个账号仅首个应用送 100 点，最多 5 个应用。</p><a href="/downloads/foodlink-mcp-latest.zip" download className="block text-primary">下载 MCP 安装包</a></div></details>
      </>}

      {creatingApp && <Dialog open onOpenChange={(open, details) => { if (!open) { if (busy) details.cancel(); else setCreatingApp(false) } }}><DialogContent className="p-6 sm:max-w-lg" showCloseButton={!busy}><DialogHeader><DialogTitle className="text-xl">给接入起个名字</DialogTitle><DialogDescription className="text-base">比如“我的饮食助手”。不是另建一个 AI。</DialogDescription></DialogHeader><input aria-label="应用名称" className={inputClass} value={appName} maxLength={40} onChange={(e) => setAppName(e.target.value)} />{error && <p role="alert" className="text-base text-destructive">{error}</p>}<Button disabled={busy || appName.trim().length < 2} onClick={() => run(async () => { const material = await developerApi.createApp(appName); setCreatingApp(false); rememberKey(material); await load() })}>{busy && <LoaderCircle className="animate-spin" />}创建并获取密钥</Button></DialogContent></Dialog>}
      {creatingKey && <CreateAPIKeyDialog app={creatingKey} onClose={() => setCreatingKey(null)} onCreated={(material) => { rememberKey(material); void run(load) }} />}
      {importingKey && <ImportAPIKeyDialog {...importingKey} onClose={() => setImportingKey(null)} onImported={(material) => rememberKey(material, true)} onNewKey={() => { const app = importingKey.app; setImportingKey(null); setCreatingKey(app) }} />}
      {keyDialog && <APIKeySaveDialog key={keyDialog.material.api_key.id} {...keyDialog} onClose={() => setKeyDialog(null)} />}
      {paymentApp && <Dialog open onOpenChange={(open, details) => { if (!open) { if (busy) details.cancel(); else setPaymentApp(null) } }}><DialogContent className="p-6 sm:max-w-xl" showCloseButton={!busy}><DialogHeader><DialogTitle className="text-xl">充值点数</DialogTitle><DialogDescription className="text-base">充值到 {paymentApp.name}</DialogDescription></DialogHeader>{packages.length === 0 ? <p className="text-base">充值暂未开放，请联系食探。</p> : <div className="grid gap-3 sm:grid-cols-3">{packages.map((item) => <button key={item.code} disabled={busy} className="rounded-xl border p-4 text-left disabled:opacity-50" onClick={() => run(async () => { const order = await developerApi.createPayment(paymentApp.id, item.code); setPaymentApp(null); setPayment(order) })}><strong>{item.name}</strong><p className="mt-2 text-base">{item.units} 点</p><p className="mt-3 text-lg font-bold">¥{(item.amount_fen / 100).toFixed(2)}</p></button>)}</div>}{error && <p role="alert" className="text-base text-destructive">{error}</p>}</DialogContent></Dialog>}
      {payment && <Dialog open onOpenChange={(open) => { if (!open) setPayment(null) }}><DialogContent className="p-6 text-center"><DialogHeader><DialogTitle className="text-xl">微信扫码充值</DialogTitle><DialogDescription className="sr-only">订单 {payment.order_no}</DialogDescription></DialogHeader>{payment.status === 'paid' ? <div className="my-5"><Check className="mx-auto size-14 text-primary" /><p className="mt-3 text-base font-semibold">支付成功，点数已到账</p></div> : <div className="mx-auto my-3 w-fit rounded-xl border bg-white p-3">{(payment.qr_code_value || payment.code_url) && <QRCodeSVG value={payment.qr_code_value || payment.code_url || ''} size={220} />}</div>}<p className="text-base">¥{(payment.amount_fen / 100).toFixed(2)} · {payment.units} 点</p><Button variant="outline" onClick={() => setPayment(null)}>{payment.status === 'paid' ? '完成' : '稍后支付'}</Button></DialogContent></Dialog>}
    </main><SiteFooter />
  </div>
}
