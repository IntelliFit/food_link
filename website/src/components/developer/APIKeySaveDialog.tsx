import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { KeyMaterial } from '@/lib/developer-api'
import { FreeAPIConnectionCheck } from './FreeAPIConnectionCheck'

export function APIKeySaveDialog({ material, onClose }: { material: KeyMaterial; onClose: () => void }) {
  const keyField = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [])

  function selectKey() {
    keyField.current?.focus()
    keyField.current?.select()
  }

  async function copyKey() {
    setCopying(true)
    setError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(material.secret)
      setCopied(true)
    } catch {
      setCopied(false)
      selectKey()
      setError('浏览器未允许自动复制。完整密钥已选中，请按 Ctrl+C（Mac 按 ⌘C），或下载密钥文件。')
    } finally {
      setCopying(false)
    }
  }

  function downloadKey() {
    setError('')
    let url: string | undefined
    let link: HTMLAnchorElement | undefined
    try {
      url = URL.createObjectURL(new Blob([material.secret], { type: 'text/plain;charset=utf-8' }))
      link = document.createElement('a')
      link.href = url
      link.download = `foodlink-api-key-${material.api_key.id}.txt`
      document.body.appendChild(link)
      link.click()
      setDownloaded(true)
    } catch {
      setError('下载未能启动，请使用复制按钮或选中密钥后手动复制。')
    } finally {
      link?.remove()
      if (url) {
        const downloadURL = url
        window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1000)
      }
    }
  }

  return <Dialog open disablePointerDismissal onOpenChange={(open, details) => {
    if (open) return
    if (!saved || copying) {
      details.cancel()
      setError('请先复制或下载完整密钥，再勾选“我已保存密钥”后关闭。')
      return
    }
    onClose()
  }}>
    <DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto p-6 sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-xl font-bold">密钥已创建，请先保存</DialogTitle>
        <DialogDescription className="leading-6">完整密钥仅在这里显示。关闭或刷新后无法再次查看；下方列表只保留标识，不能用来调用 API。</DialogDescription>
      </DialogHeader>
      <p className="text-sm">应用：{material.app.name} · {material.api_key.name}</p>
      <textarea ref={keyField} aria-label="完整 API Key" readOnly spellCheck={false} autoComplete="off" value={material.secret} onFocus={(event) => event.currentTarget.select()} className="min-h-24 w-full resize-none rounded-xl border border-input bg-muted/50 p-3 font-mono text-sm break-all outline-none focus:border-primary" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={copying} onClick={copyKey}>{copied ? <Check /> : <Copy />}{copied ? '已复制完整密钥' : '复制完整密钥'}</Button>
        <Button variant="outline" onClick={downloadKey}><Download />下载密钥文件</Button>
        <Button variant="ghost" onClick={selectKey}>选中手动复制</Button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive">{error}</p>}
      {downloaded && <p role="status" className="text-sm text-primary">下载已发起，请确认文件已保存到本机。</p>}
      <FreeAPIConnectionCheck apiKey={material.secret} />
      <p className="text-sm leading-6 text-muted-foreground">交给 AI 接入时，提供本机密钥文件的路径即可。不要把完整密钥发到聊天里或写入网页、设备固件。</p>
      <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />我已保存密钥，知道关闭后无法再次查看</label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <a href="/developer/ai-guide.md" target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">查看 AI 接入说明</a>
        <DialogClose render={<Button disabled={!saved || copying} />}>完成</DialogClose>
      </div>
    </DialogContent>
  </Dialog>
}
