import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkOpenAPIConnection, type OpenAPIConnectionResult } from '@/lib/developer-api'

export function FreeAPIConnectionCheck({ apiKey }: { apiKey?: string }) {
  const [inputKey, setInputKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OpenAPIConnectionResult | null>(null)
  const [error, setError] = useState('')

  async function check() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await checkOpenAPIConnection(apiKey ?? inputKey))
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接未成功，请稍后再试。')
    } finally {
      setBusy(false)
      setInputKey('')
    }
  }

  return <section aria-label="免费 API 验证" className="rounded-xl border border-border bg-background p-4">
    <h3 className="font-semibold">验证 API · 0 点</h3>
    {!apiKey && <input aria-label="待验证的完整 API Key" type="password" autoComplete="off" spellCheck={false} value={inputKey} disabled={busy} onChange={(event) => { setInputKey(event.target.value); setResult(null); setError('') }} placeholder="粘贴完整密钥" className="mt-3 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary" />}
    <Button className="mt-3" variant="outline" disabled={busy || !(apiKey ?? inputKey).trim()} onClick={check}>{busy ? <LoaderCircle className="animate-spin" aria-label="正在验证" /> : <Check />}免费验证连接</Button>
    {error && <p role="alert" className="mt-3 text-sm leading-6 text-destructive">{error}</p>}
    {result && <div role="status" className="mt-3 space-y-1 text-base leading-6"><p className="font-semibold text-primary">账户已连通 · {result.account.app_name}</p><p>余额 {result.account.balance_units} 点</p><p>{result.searchMessage}</p></div>}
  </section>
}
