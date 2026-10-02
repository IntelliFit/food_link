import { useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiSetupPrompt } from '@/lib/ai-setup-prompt'

export function AIHandoffCard() {
  const promptField = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function copyPrompt() {
    setError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(aiSetupPrompt)
      setCopied(true)
    } catch {
      setCopied(false)
      promptField.current?.focus()
      promptField.current?.select()
      setError('自动复制未成功。文字已选中，请按 Ctrl+C（Mac 按 ⌘C），再粘贴给你的 AI。')
    }
  }

  return <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 md:p-6">
    <h3 className="text-lg font-semibold">复制给 AI，让它带你完成接入</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">可交给 Codex、WorkBuddy 或其他能执行接入任务的 AI 助手。你只需准备账号和密钥文件，不用自己选 API 或 MCP。</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button onClick={copyPrompt}>{copied ? <Check /> : <Copy />}{copied ? '已复制，可以发给 AI' : '复制给 AI'}</Button>
      <Button variant="outline" nativeButton={false} render={<a href="/developer/ai-guide.md" download />}><Download />下载 AI 接入说明（Markdown）</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm leading-6 text-destructive">{error}</p>}
    <textarea ref={promptField} aria-label="给 AI 的接入任务" readOnly value={aiSetupPrompt} className="mt-4 h-44 w-full resize-y rounded-xl border border-border bg-background p-4 text-sm leading-6 outline-none focus:border-primary" />
    <p className="mt-3 text-sm leading-6 text-muted-foreground">把上面的任务粘贴给 AI；等它询问时，只提供密钥文件路径。第一步先查账户和营养库，免费验证通过后再由你选择收费测试。</p>
  </div>
}
