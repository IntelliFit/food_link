import { useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiSetupPrompt } from '@/lib/ai-setup-prompt'

export function AIHandoffCard({ compact = false }: { compact?: boolean }) {
  const promptField = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  async function copyPrompt() {
    setError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(aiSetupPrompt)
      setCopied(true)
    } catch {
      setCopied(false)
      setExpanded(true)
      window.setTimeout(() => { promptField.current?.focus(); promptField.current?.select() }, 0)
      setError('自动复制未成功。文字已选中，请按 Ctrl+C（Mac 按 ⌘C），再粘贴给你的 AI。')
    }
  }

  return <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 md:p-6">
    <h3 className="text-lg font-semibold">交给 Codex / WorkBuddy 接入</h3>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button onClick={copyPrompt}>{copied ? <Check /> : <Copy />}{copied ? '已复制，可以发给 AI' : '复制给 AI'}</Button>
      {!compact && <Button variant="outline" nativeButton={false} render={<a href="https://healthymax.cn/developer/ai-guide.md" download />}><Download />下载接入说明</Button>}
      <Button variant="ghost" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '查看任务内容'}</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm leading-6 text-destructive">{error}</p>}
    <div hidden={!expanded}><textarea ref={promptField} aria-label="给 AI 的接入任务" readOnly value={aiSetupPrompt} className="mt-4 h-44 w-full resize-y rounded-xl border border-border bg-background p-4 text-base leading-6 outline-none focus:border-primary" /></div>
    {!compact && <p className="mt-3 text-base leading-6 text-muted-foreground">粘贴任务给 AI，再提供密钥文件路径。</p>}
  </div>
}
