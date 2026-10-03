export function GettingStartedSteps() {
  return <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
    <h2 className="text-xl font-bold">接入只需三步</h2>
    <ol className="mt-5 grid gap-5 sm:grid-cols-3">
      {[
        '登录，获取密钥', '下载密钥文件', '复制接入任务给 AI',
      ].map((title, index) => <li key={title} className="flex items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{index + 1}</span><h3 className="font-semibold">{title}</h3></li>)}
    </ol>
  </div>
}
