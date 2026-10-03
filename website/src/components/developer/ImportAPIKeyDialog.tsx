import { useRef, useState } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { checkOpenAPIConnection, type ApiKeySummary, type DeveloperApp, type KeyMaterial } from '@/lib/developer-api'

export function ImportAPIKeyDialog({ app, apiKey, onImported, onNewKey, onClose }: { app: DeveloperApp; apiKey: ApiKeySummary; onImported: (material: KeyMaterial) => void; onNewKey: () => void; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [rawKey, setRawKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function verifyAndImport(raw: string) {
    setBusy(true)
    setError('')
    try {
      const secret = raw.trim()
      if (!apiKey.key_prefix || !secret.startsWith(apiKey.key_prefix)) throw new Error('这不是所选密钥的文件，请选择对应文件。')
      const result = await checkOpenAPIConnection(secret)
      if (result.account.app_id !== app.id) throw new Error('这把密钥属于其他应用，请选择对应文件。')
      setRawKey('')
      onImported({ app, api_key: apiKey, secret })
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请重试。')
    } finally {
      setBusy(false)
      setRawKey('')
    }
  }

  async function importFile(file: File) {
    if (file.size > 4096) { setError('请选择下载时保存的密钥文本文件。'); return }
    setBusy(true)
    try { await verifyAndImport(await file.text()) } catch { setError('无法读取文件，请重新选择。'); setBusy(false) }
  }

  return <Dialog open onOpenChange={(open, details) => { if (!open) { if (busy) details.cancel(); else onClose() } }}>
    <DialogContent className="p-6 sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle className="text-xl">导入后即可复制</DialogTitle><DialogDescription className="text-base">服务器无法找回旧密钥，请选择你保存的文件。</DialogDescription></DialogHeader>
      <input ref={fileInput} aria-label="密钥文件" type="file" accept=".txt,text/plain" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
      <Button disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle className="animate-spin" aria-label="正在验证" /> : <FileUp />}选择密钥文件</Button>
      <details><summary className="cursor-pointer py-2 text-base">或粘贴完整密钥</summary><div className="mt-2 flex gap-2"><input type="password" aria-label="导入的完整密钥" value={rawKey} autoComplete="off" disabled={busy} onChange={(event) => setRawKey(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-base" /><Button disabled={busy || !rawKey.trim()} onClick={() => verifyAndImport(rawKey)}>导入</Button></div></details>
      {error && <p role="alert" className="text-base text-destructive">{error}</p>}
      <div className="border-t pt-4"><Button variant="ghost" disabled={busy} onClick={onNewKey}>没有保存？新建一把（余额不变）</Button></div>
    </DialogContent>
  </Dialog>
}
