export function GettingStartedSteps() {
  return <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
    <h2 className="text-xl font-bold">第一次用？照着这四步走</h2>
    <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['登录并创建应用', '应用就是这次接入的名字，比如“我的饮食助手”。每个账号仅第一个应用送 100 点。'],
        ['保存完整密钥', '创建后会弹出保存窗口，点击“下载密钥文件”。新建密钥不扣点。'],
        ['把接入任务交给 AI', '点击“复制给 AI”，粘贴到你常用的 AI 助手；它询问时再提供文件路径。'],
        ['先免费验证，再试餐照', '先查询余额、搜索营养，确认连通。普通餐照 5 点/张，文字 2 点/次。'],
      ].map(([title, text], index) => <li key={title} className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}
    </ol>
  </div>
}
