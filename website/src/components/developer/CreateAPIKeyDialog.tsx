import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { developerApi, type DeveloperApp, type KeyMaterial } from '@/lib/developer-api'

export function CreateAPIKeyDialog({ app, onCreated, onClose }: { app: DeveloperApp; onCreated: (material: KeyMaterial) => void; onClose: () => void }) {
  const [personal, setPersonal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    try {
      const scopes = ['food:analyze', 'food:search', ...(personal ? ['records:read', 'health:read'] : [])]
      const material = await developerApi.createKey(app.id, `密钥 ${new Date().toLocaleDateString()}`, scopes)
      onCreated(material)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open onOpenChange={(open, details) => { if (!open) { if (busy) details.cancel(); else onClose() } }}>
    <DialogContent className="p-6 sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle className="text-xl">新建密钥</DialogTitle><DialogDescription className="text-base">选择你希望 AI 做什么。</DialogDescription></DialogHeader>
      <fieldset className="space-y-3 text-base" disabled={busy}>
        <legend className="sr-only">密钥用途</legend>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-4"><input type="radio" name="key-purpose" checked={!personal} onChange={() => setPersonal(false)} />识别餐照、查询营养</label>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-4"><input type="radio" name="key-purpose" checked={personal} onChange={() => setPersonal(true)} />以上功能 ＋ 查看我的饮食历史和健康评分</label>
      </fieldset>
      {error && <p role="alert" className="text-base text-destructive">{error}</p>}
      <Button disabled={busy} onClick={create}>{busy && <LoaderCircle className="animate-spin" aria-label="正在创建" />}创建密钥</Button>
    </DialogContent>
  </Dialog>
}
