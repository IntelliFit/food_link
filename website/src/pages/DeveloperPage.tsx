import { ArrowRight, Bot, Braces, Camera, Cpu, Download, KeyRound, ShieldCheck, WalletCards } from 'lucide-react'
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
              <Button size="lg" variant="outline" render={<Link to="/developer/docs" />}>查看完整开发文档</Button>
              <Button size="lg" variant="outline" render={<a href="/downloads/foodlink-mcp-latest.zip" download />}><Download />下载官方 MCP</Button>
              <Button size="lg" variant="ghost" render={<a href="/developer/ai-guide.md" download />}>下载给 AI 的接入说明</Button>
            </div>
          </div>
          <div className="rounded-3xl border border-border bg-card p-5 shadow-xl shadow-primary/5 md:p-8">
            <div className="mb-5 flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Camera className="size-4 text-primary" /> 图片识别完整链路</span><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">上传 → 分析 → 轮询</span></div>
            <pre className="overflow-x-auto rounded-2xl bg-foreground p-5 text-xs leading-6 text-background md:text-sm"><code>{`# 1. 上传图片
curl ${openApiBaseURL}/uploads \\
  -H "Authorization: Bearer $FOODLINK_API_KEY" \\
  -F "file=@meal.jpg"

# 2. 使用返回的 image_url 提交分析
curl ${openApiBaseURL}/food-analyses \\
  -H "Authorization: Bearer $FOODLINK_API_KEY" \\
  -H "Idempotency-Key: meal-photo-001" \\
  -H "Content-Type: application/json" \\
  -d '{"image_urls":["..."],"mode":"precision",
       "meal_type":"lunch","additional_context":"没喝汤"}'`}</code></pre>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 md:grid-cols-3 md:px-8">
          {capabilities.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-border bg-card p-6"><Icon className="mb-5 size-8 text-primary" /><h2 className="mb-2 text-lg font-semibold">{title}</h2><p className="text-sm leading-7 text-muted-foreground">{text}</p></article>)}
        </section>

        <section id="quickstart" className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <div className="rounded-3xl border border-border bg-card p-6 md:p-10">
            <h2 className="mb-8 text-2xl font-bold md:text-3xl">从 0 到第一次调用</h2>
            <ol className="grid gap-5 md:grid-cols-3">
              {[['1', '短信登录并创建应用', '每个开发者账号仅第一个应用赠送 100 个测试点。'], ['2', '复制一次性 API Key', '服务端只保存哈希；密钥只展示一次。'], ['3', '按完整文档接入', '支持文字、图片、多图、普通/精准模式、营养搜索、任务轮询与 MCP。']].map(([n, title, text]) => <li key={n} className="flex gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}
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
