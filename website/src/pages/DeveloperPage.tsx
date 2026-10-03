import { ArrowRight, Bot, Camera, Database, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { AIHandoffCard } from '@/components/developer/AIHandoffCard'
import { GettingStartedSteps } from '@/components/developer/GettingStartedSteps'

export function DeveloperPage() {
  return <div className="min-h-screen bg-gradient-page">
    <SiteHeader />
    <main className="pt-below-header">
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-2 md:px-8 md:py-20">
        <div className="flex flex-col items-start gap-6">
          <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">食探开放平台 Beta · 支持 AI 自助接入</span>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">给你的 AI 助手<br /><span className="text-primary">加上看懂每一餐的能力</span></h1>
          <p className="text-base leading-8 text-muted-foreground md:text-lg">把餐照分析、食物营养和你的饮食历史接入常用 AI 助手。会向 Codex、WorkBuddy 提需求，就可以让它带你完成接入，不必先学接口文档。</p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" nativeButton={false} render={<Link to="/developer/console" />}>开始接入 <ArrowRight /></Button>
            <Button size="lg" variant="outline" nativeButton={false} render={<a href="#ai-start" />}><Bot />复制任务给 AI</Button>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">每个账号的第一个应用赠送 100 点。账户查询和营养搜索先免费验证；普通餐照 5 点/张，文字分析 2 点/次。</p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-xl shadow-primary/5 md:p-8">
          <h2 className="text-xl font-bold">接好后，你可以直接这样问 AI</h2>
          <div className="mt-6 space-y-5">
            {[
              { icon: Camera, title: '发一张餐照', example: '“分析这顿饭的热量和蛋白质。我只吃了一半米饭。”', note: '返回食物明细、估算重量、营养与不确定性说明。' },
              { icon: Database, title: '查一种食物', example: '“查一下鸡胸肉的营养信息。”', note: '查询食探营养库，Beta 期免费。' },
              { icon: History, title: '回顾我的饮食', example: '“读取我最近一周的记录，看看蛋白质和健康评分。”', note: '需主动开启个人数据读取权限，并已有食探记录；只读，不修改记录。' },
            ].map(({icon: Icon, title, example, note}) => <article key={title} className="border-b border-border pb-5 last:border-0 last:pb-0"><div className="flex items-center gap-2 font-semibold"><Icon className="size-5 text-primary" />{title}</div><p className="mt-2 text-base leading-7">{example}</p><details className="mt-2"><summary className="cursor-pointer text-base text-muted-foreground">了解功能</summary><p className="mt-2 text-base leading-6 text-muted-foreground">{note}</p></details></article>)}
          </div>
        </div>
      </section>
      <section id="quickstart" className="mx-auto max-w-6xl scroll-mt-28 px-4 pb-10 md:px-8"><GettingStartedSteps /></section>
      <section id="ai-start" className="mx-auto max-w-6xl scroll-mt-28 px-4 pb-12 md:px-8"><AIHandoffCard /></section>
      <section className="mx-auto max-w-6xl px-4 pb-12 md:px-8">
        <h2 className="text-2xl font-bold">第一次接入，常见的问题</h2>
        <div className="mt-5 divide-y divide-border rounded-2xl border border-border bg-card px-5">
          {[
            ['“应用”是什么？', '它是这次接入的名字和独立账本，比如“我的饮食助手”，不需要开发或下载一个新 App。多台电脑可接入同一应用；重新创建密钥不会再赠送点数。'],
            ['API、MCP 要选哪个？', '先把任务交给 AI。API 是食探提供能力的接口，MCP 是让 AI 使用这些接口的一套现成工具。AI 会根据当前客户端能力选择；两种方式用同一应用余额。'],
            ['旧密钥怎么再次复制？', '点击列表里的“复制”。本页新建的密钥可直接查看；刷新后先导入已保存文件。服务器无法找回完整旧密钥，没有文件就新建一把，余额不变。'],
            ['怎样知道接入成功？', '在密钥弹窗展开“测试连接（免费）”，或让 AI 查一次余额和“鸡胸肉”营养。成功后发一张餐照，确认收到最终食物明细，而不是只看到任务编号。'],
            ['余额不足会突然弹出支付吗？', '不会。AI 会告诉你余额不足，由你到控制台选择套餐并主动扫码充值。API 点数与食探小程序会员积分独立。'],
            ['识别结果会自动写进我的饮食记录吗？', '不会。食物分析属于当前应用的分析历史；读取个人饮食记录需要你额外授权。这些只读接口不提供修改或删除个人记录的能力。'],
          ].map(([question,answer]) => <details key={question} className="py-4"><summary className="cursor-pointer font-medium">{question}</summary><p className="mt-3 text-sm leading-7 text-muted-foreground">{answer}</p></details>)}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8"><div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/70 p-6"><div><h2 className="font-semibold">要接自己的产品或硬件？</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">完整文档提供图片、文字、多图、参数、计费、任务轮询与 MCP 安装说明。</p></div><Button variant="outline" nativeButton={false} render={<Link to="/developer/docs" />}>查看完整开发文档 <ArrowRight /></Button></div></section>
    </main>
    <SiteFooter />
  </div>
}
