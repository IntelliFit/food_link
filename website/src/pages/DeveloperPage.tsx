import { ArrowRight, Bot, Braces, Cpu, KeyRound, ShieldCheck, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { openApiBaseURL } from '@/lib/developer-api'

const capabilities = [
  { icon: Braces, title: '统一 HTTP API', text: '文字或图片食物分析、异步结果查询和可信营养库搜索。' },
  { icon: Bot, title: 'WorkBuddy / Codex / MCP', text: '通过同一 API Key 接入 Agent，MCP 只是轻量适配层，不重复计费。' },
  { icon: Cpu, title: '硬件友好', text: '设备经你的服务端调用，密钥不写入固件；支持按应用隔离余额和审计。' },
]

export function DeveloperPage() {
  return (
    <div className="min-h-screen bg-gradient-page">
      <SiteHeader />
      <main className="pt-below-header">
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.1fr_.9fr] md:px-8 md:py-20">
          <div className="flex flex-col items-start gap-6">
            <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">食探开放平台 Beta</span>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">让你的 Agent 和硬件<br /><span className="text-primary">看懂每一餐</span></h1>
            <p className="max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">一套 API 覆盖上传、食物识别、营养搜索、点数计费和调用审计。余额不足时返回 402，由调用方提示用户前往官网充值，不会突然代替用户发起付款。</p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" render={<Link to="/developer/console" />}>进入开发者控制台 <ArrowRight /></Button>
              <Button size="lg" variant="outline" render={<a href="#quickstart" />}>查看快速开始</Button>
              <Button size="lg" variant="ghost" render={<a href="/openapi/foodlink-openapi-v1.yaml" download />}>下载 OpenAPI 3.1</Button>
            </div>
          </div>
          <div className="rounded-3xl border border-border bg-card p-5 shadow-xl shadow-primary/5 md:p-8">
            <div className="mb-5 flex items-center justify-between"><span className="font-semibold">POST /open/v1/food-analyses</span><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">202 Accepted</span></div>
            <pre className="overflow-x-auto rounded-2xl bg-foreground p-5 text-sm leading-7 text-background"><code>{`curl ${openApiBaseURL}/food-analyses \\
  -H "Authorization: Bearer $FOODLINK_API_KEY" \\
  -H "Idempotency-Key: meal-20260901-001" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"一碗牛肉面","mode":"standard"}'`}</code></pre>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 md:grid-cols-3 md:px-8">
          {capabilities.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-border bg-card p-6"><Icon className="mb-5 size-8 text-primary" /><h2 className="mb-2 text-lg font-semibold">{title}</h2><p className="text-sm leading-7 text-muted-foreground">{text}</p></article>)}
        </section>

        <section id="quickstart" className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <div className="rounded-3xl border border-border bg-card p-6 md:p-10">
            <h2 className="mb-8 text-2xl font-bold md:text-3xl">从 0 到第一次调用</h2>
            <ol className="grid gap-5 md:grid-cols-3">
              {[['1', '短信登录并创建应用', '首次创建赠送 100 个 Beta 测试点。'], ['2', '复制一次性 API Key', '服务端只保存哈希；密钥只展示一次。'], ['3', '调用 API 或安装 MCP', '文字 2 点，普通图片 5 点/张，精准图片 15 点/张。']].map(([n, title, text]) => <li key={n} className="flex gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-3 md:px-8">
          {[{ icon: WalletCards, title: '可控支付', text: 'PC 官网扫码充值；只有微信回调验签和金额校验通过才会入账。' }, { icon: KeyRound, title: '最小权限密钥', text: '分析与搜索 scope 可独立控制，密钥可随时吊销。' }, { icon: ShieldCheck, title: '幂等和审计', text: '同一个 Idempotency-Key 不会重复提交任务或重复扣点。' }].map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl bg-muted/70 p-6"><Icon className="mb-4 text-primary" /><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></article>)}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
