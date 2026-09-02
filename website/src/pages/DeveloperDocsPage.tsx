import { ArrowRight, BookOpen, Bot, Camera, CircleDollarSign, Database, KeyRound, ShieldCheck, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { openApiBaseURL } from '@/lib/developer-api'

const navItems = [
  ['overview', '接入概览'],
  ['authentication', '鉴权与幂等'],
  ['image-analysis', '图片识别'],
  ['text-analysis', '文字分析'],
  ['parameters', '完整参数'],
  ['results', '任务与结果'],
  ['nutrition-search', '营养库搜索'],
  ['mcp', 'MCP / WorkBuddy'],
  ['billing', '计费与错误码'],
] as const

const analysisParameters = [
  ['text', 'string', '与 image_urls 二选一', '自然语言餐食描述，例如“一碗牛肉面，少喝汤”。'],
  ['image_urls', 'string[]', '与 text 二选一', '先通过上传接口取得；最多 5 张，且必须属于当前应用。'],
  ['mode', 'standard | precision', '否', 'standard 普通识别；precision 精准识别。默认 standard。'],
  ['meal_type', 'enum', '否', 'breakfast、morning_snack、lunch、afternoon_snack、dinner、evening_snack。'],
  ['additional_context', 'string', '否', '补充不可从图片确定的信息，如“没有喝汤”“米饭只吃一半”。'],
  ['date', 'YYYY-MM-DD', '否', '餐食发生日期，例如 2026-09-03。'],
] as const

const resultFields = [
  ['task_id / status', '任务 ID 与 queued、processing、requires_action、completed、failed 状态。'],
  ['result.items[]', '识别出的食物明细，包括名称、估算重量、置信度和复合食物拆分。'],
  ['items[].nutrients', '热量、蛋白质、脂肪、碳水、膳食纤维及可用的微量营养素。'],
  ['description / insight', '本餐摘要与营养洞察。'],
  ['context_advice', '结合餐食内容生成的饮食建议。'],
  ['uncertaintyNotes', '图片、份量或烹饪方式不确定时的说明。'],
  ['cost_units / balance_units', '本次消耗点数；失败退款时返回最新余额与 refunded。'],
] as const

const errorCodes = [
  ['400', '参数错误、图片格式不支持，或 text 与 image_urls 同时提交。'],
  ['401', 'API Key 缺失、错误、过期或已吊销。'],
  ['402', 'API 点数不足；提示用户前往控制台充值，不得自动付款。'],
  ['403', 'API Key 缺少 food:analyze 或 food:search 权限。'],
  ['409', 'Idempotency-Key 已用于不同请求，或原提交尚未完成。'],
  ['429', '请求超过限流；读取 Retry-After 后重试。'],
  ['503', '限流或关键依赖暂不可用；稍后重试。'],
] as const

function CodeBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
        <span>{title}</span><span>HTTP</span>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6"><code>{children}</code></pre>
    </div>
  )
}

function DocSection({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-b border-border pb-14 last:border-0">
      <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      {intro && <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">{intro}</p>}
      <div className="mt-7">{children}</div>
    </section>
  )
}

function ParamTable({ rows }: { rows: readonly (readonly string[])[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-muted/70 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">参数</th><th className="px-4 py-3 font-medium">类型</th><th className="px-4 py-3 font-medium">必填</th><th className="px-4 py-3 font-medium">说明</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map(([name, type, required, description]) => <tr key={name}><td className="px-4 py-4 font-mono text-xs font-semibold text-primary">{name}</td><td className="px-4 py-4 font-mono text-xs">{type}</td><td className="px-4 py-4">{required}</td><td className="px-4 py-4 leading-6 text-muted-foreground">{description}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

export function DeveloperDocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="pt-below-header">
        <section className="border-b border-border bg-gradient-page">
          <div className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-16">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Link className="hover:text-primary" to="/developer">开放平台</Link><span>/</span><span>开发文档</span><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">v0.2 Beta</span></div>
            <div className="mt-6 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div><h1 className="text-4xl font-bold tracking-tight md:text-5xl">FoodLink Open API</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">从图片上传、普通/精准食物识别，到营养库搜索和 MCP 接入的完整说明。当前环境 API 基址：<code className="rounded bg-muted px-2 py-1 text-sm text-foreground">{openApiBaseURL}</code></p></div>
              <div className="flex flex-wrap gap-3"><Button render={<Link to="/developer/console" />}>创建应用与 Key <ArrowRight /></Button><Button variant="outline" render={<a href="/openapi/foodlink-openapi-v1.yaml" download />}>下载 OpenAPI 3.1</Button></div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:px-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden lg:block"><nav className="sticky top-28 space-y-1 rounded-2xl border border-border bg-card p-3" aria-label="开发文档目录">{navItems.map(([id, label]) => <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">{label}</a>)}</nav></aside>
          <div className="space-y-14">
            <DocSection id="overview" title="接入概览" intro="对外能力只有一套版本化 HTTP API。Codex、WorkBuddy、MCP 和硬件网关都调用同一套接口、共享相同鉴权和点数账本。">
              <div className="grid gap-4 md:grid-cols-3">{[
                { icon: Camera, title: '图片食物识别', text: '上传 JPEG、PNG、WebP 后，支持普通与精准模式；一次最多 5 张图。' },
                { icon: Database, title: '可信营养数据', text: '按关键词搜索食物库，适合配餐、营养问答和硬件端展示。' },
                { icon: Bot, title: 'Agent / MCP', text: '提供 7 个 MCP 工具，支持 Codex、WorkBuddy 与通用 stdio 客户端。' },
              ].map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-border bg-card p-5"><Icon className="size-7 text-primary" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></article>)}</div>
              <div className="mt-5 overflow-hidden rounded-2xl border border-border"><div className="divide-y divide-border">{[
                ['GET', '/account', '查询当前应用、scope 与点数余额'],
                ['POST', '/uploads', '上传 JPEG、PNG 或 WebP 食物图片'],
                ['POST', '/food-analyses', '提交文字或图片分析任务'],
                ['GET', '/food-analyses/{task_id}', '查询异步任务状态与结果'],
                ['GET', '/foods/search', '搜索可信营养库'],
              ].map(([method, path, description]) => <div key={path} className="grid gap-2 p-4 text-sm md:grid-cols-[64px_250px_1fr]"><strong className={method === 'POST' ? 'text-amber-600' : 'text-primary'}>{method}</strong><code>{path}</code><span className="text-muted-foreground">{description}</span></div>)}</div></div>
              <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-sm leading-7"><strong>测试额度规则：</strong>每个开发者账号只有第一次创建的第一个应用赠送 100 点；继续创建 Agent/App 不再重复赠送。应用之间余额独立。</div>
            </DocSection>

            <DocSection id="authentication" title="鉴权与幂等" intro="完整 API Key 只展示一次。推荐通过环境变量或只读文件注入，不要写入前端代码、聊天记录或设备固件。">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl border border-border p-5"><KeyRound className="text-primary" /><h3 className="mt-3 font-semibold">Authorization</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">支持 <code>Authorization: Bearer KEY</code> 或 <code>X-API-Key: KEY</code>。密钥 scope 为 <code>food:analyze</code>、<code>food:search</code>。</p></div>
                <div className="rounded-2xl border border-border p-5"><ShieldCheck className="text-primary" /><h3 className="mt-3 font-semibold">Idempotency-Key</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">每次分析提交必须携带，最长 128 字符。网络重试必须复用原值，避免重复任务和重复扣点。</p></div>
              </div>
              <CodeBlock title="公共请求头">{`Authorization: Bearer $FOODLINK_API_KEY\nContent-Type: application/json\nIdempotency-Key: your-business-request-id`}</CodeBlock>
            </DocSection>

            <DocSection id="image-analysis" title="图片识别：上传 → 提交 → 轮询" intro="图片不能直接使用任意外部 URL。必须先上传到当前应用的隔离目录，再把返回的 image_url 用于分析。">
              <div className="space-y-5">
                <CodeBlock title="1. 上传图片">{`curl -X POST "${openApiBaseURL}/uploads" \\\n  -H "Authorization: Bearer $FOODLINK_API_KEY" \\\n  -F "file=@meal.jpg"\n\n# 返回：data.image_url、data.bytes、data.mime_type`}</CodeBlock>
                <CodeBlock title="2. 提交精准图片分析（完整参数）">{`curl -X POST "${openApiBaseURL}/food-analyses" \\\n  -H "Authorization: Bearer $FOODLINK_API_KEY" \\\n  -H "Idempotency-Key: lunch-20260903-photo-001" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "image_urls": ["上传接口返回的 image_url"],\n    "mode": "precision",\n    "meal_type": "lunch",\n    "date": "2026-09-03",\n    "additional_context": "米饭只吃了一半，没有喝汤"\n  }'`}</CodeBlock>
                <p className="rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground">普通图片每张 5 点；精准图片每张 15 点。多图按图片数量计费。支持 JPEG、PNG、WebP，单张最大 8MB，一次最多 5 张。</p>
              </div>
            </DocSection>

            <DocSection id="text-analysis" title="文字分析" intro="适合语音转文字、聊天记录或没有照片的餐食。文字与图片不能在同一次请求中同时提交。">
              <CodeBlock title="文字分析（完整参数）">{`curl -X POST "${openApiBaseURL}/food-analyses" \\\n  -H "Authorization: Bearer $FOODLINK_API_KEY" \\\n  -H "Idempotency-Key: dinner-20260903-text-001" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "text": "番茄炒蛋一份、米饭约 150 克",\n    "mode": "standard",\n    "meal_type": "dinner",\n    "date": "2026-09-03",\n    "additional_context": "番茄炒蛋两人分食，我吃了一半"\n  }'`}</CodeBlock>
              <p className="mt-4 text-sm text-muted-foreground">文字分析每次 2 点。当前文字请求接受 <code>mode</code>，但计费固定为 2 点；它主要根据描述估算，不等同于图片识别。</p>
            </DocSection>

            <DocSection id="parameters" title="POST /food-analyses 完整参数">
              <ParamTable rows={analysisParameters} />
            </DocSection>

            <DocSection id="results" title="异步任务与结果" intro="提交成功返回 HTTP 202。使用 task_id 轮询，queued/processing 时继续等待，直到 completed、failed 或 requires_action。">
              <div className="space-y-5">
                <CodeBlock title="查询任务">{`curl "${openApiBaseURL}/food-analyses/{task_id}" \\\n  -H "Authorization: Bearer $FOODLINK_API_KEY"`}</CodeBlock>
                <div className="overflow-hidden rounded-2xl border border-border"><div className="divide-y divide-border">{resultFields.map(([name, description]) => <div key={name} className="grid gap-2 p-4 md:grid-cols-[200px_1fr]"><code className="text-xs font-semibold text-primary">{name}</code><p className="text-sm leading-6 text-muted-foreground">{description}</p></div>)}</div></div>
                <CodeBlock title="completed 结果结构示例">{`{\n  "task_id": "...",\n  "status": "completed",\n  "result": {\n    "description": "午餐包含米饭、鸡胸肉和蔬菜",\n    "items": [{\n      "name": "鸡胸肉",\n      "estimatedWeightGrams": 120,\n      "nutrients": { "calories": 198, "protein": 37.2, "fat": 4.3, "carbs": 0 }\n    }],\n    "context_advice": "蔬菜量可以再增加",\n    "uncertaintyNotes": ["重量为图片估算"]\n  },\n  "cost_units": 5\n}`}</CodeBlock>
              </div>
            </DocSection>

            <DocSection id="nutrition-search" title="可信营养库搜索" intro="营养搜索 Beta 期免费，适合在分析前后查询标准食物信息。query 必填；limit 为 1–20，默认 5。">
              <CodeBlock title="GET /foods/search">{`curl "${openApiBaseURL}/foods/search?query=鸡胸肉&limit=5" \\\n  -H "Authorization: Bearer $FOODLINK_API_KEY"`}</CodeBlock>
            </DocSection>

            <DocSection id="mcp" title="MCP / WorkBuddy / Codex" intro="MCP 是本地 stdio 适配器，不保存余额，也不会自动支付。安装包内有完整 README、Codex TOML、通用 MCP JSON 和 PowerShell 验证脚本。">
              <div className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-border p-5"><Terminal className="text-primary" /><h3 className="mt-3 font-semibold">7 个工具</h3><p className="mt-2 text-sm leading-7 text-muted-foreground"><code>foodlink_get_account</code><br /><code>foodlink_upload_image</code><br /><code>foodlink_analyze_images</code><br /><code>foodlink_analyze_text</code><br /><code>foodlink_get_analysis</code><br /><code>foodlink_search_food</code><br /><code>foodlink_get_recharge_url</code></p></div><div className="rounded-2xl border border-border p-5"><BookOpen className="text-primary" /><h3 className="mt-3 font-semibold">Agent 调用顺序</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">图片：上传 → 分析 → 轮询。<br />文字：分析 → 轮询。<br />遇到 402：只返回充值页并等待用户确认。<br />重试：必须复用 idempotency_key。</p></div></div>
              <CodeBlock title="通用 MCP 配置">{`{\n  "mcpServers": {\n    "foodlink": {\n      "command": "node",\n      "args": ["C:/foodlink-mcp/src/server.mjs"],\n      "env": {\n        "FOODLINK_API_KEY_FILE": "C:/Users/YOU/.foodlink/api-key",\n        "FOODLINK_API_BASE_URL": "${openApiBaseURL}"\n      }\n    }\n  }\n}`}</CodeBlock>
            </DocSection>

            <DocSection id="billing" title="计费、余额与错误码" intro="可通过 GET /account 查询应用、scope 和余额。每个开发者账号仅首次创建的第一个应用赠送 100 点；后续应用从 0 点开始。">
              <div className="mb-5 grid gap-3 sm:grid-cols-3">{[['文字分析', '2 点 / 次'], ['普通图片', '5 点 / 张'], ['精准图片', '15 点 / 张']].map(([label, value]) => <div key={label} className="rounded-2xl border border-border p-5"><CircleDollarSign className="size-6 text-primary" /><p className="mt-3 text-sm text-muted-foreground">{label}</p><strong className="mt-1 block text-lg">{value}</strong></div>)}</div>
              <div className="overflow-hidden rounded-2xl border border-border"><div className="divide-y divide-border">{errorCodes.map(([code, description]) => <div key={code} className="grid gap-2 p-4 md:grid-cols-[80px_1fr]"><code className="font-semibold text-primary">HTTP {code}</code><p className="text-sm leading-6 text-muted-foreground">{description}</p></div>)}</div></div>
              <div className="mt-7 flex flex-wrap gap-3"><Button render={<Link to="/developer/console" />}>进入控制台 <ArrowRight /></Button><Button variant="outline" render={<a href="/openapi/foodlink-openapi-v1.yaml" />}>查看机器可读 OpenAPI</Button></div>
            </DocSection>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
