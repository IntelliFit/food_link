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
    <h3 className="font-semibold">先免费验证 API</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">查询账户、余额和“鸡胸肉”营养，不提交分析任务、不扣分析点数。{!apiKey && '请粘贴你保存的完整密钥；列表里的前缀不能使用。'}</p>
    {!apiKey && <input aria-label="待验证的完整 API Key" type="password" autoComplete="off" spellCheck={false} value={inputKey} disabled={busy} onChange={(event) => { setInputKey(event.target.value); setResult(null); setError('') }} placeholder="粘贴完整密钥" className="mt-3 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary" />}
    <Button className="mt-3" variant="outline" disabled={busy || !(apiKey ?? inputKey).trim()} onClick={check}>{busy ? <LoaderCircle className="animate-spin" aria-label="正在验证" /> : <Check />}免费验证连接</Button>
    {error && <p role="alert" className="mt-3 text-sm leading-6 text-destructive">{error}</p>}
    {result && <div role="status" className="mt-3 space-y-1 text-sm leading-6"><p className="font-semibold text-primary">账户验证成功 · {result.account.app_name}</p><p>当前余额：{result.account.balance_units} 点 · 本次验证 0 点</p><p>{result.searchMessage}</p><p>接下来可把接入任务交给 AI，再选择一张餐照进行普通分析。</p></div>}
    {!apiKey && <p className="mt-2 text-xs leading-5 text-muted-foreground">仅用于向食探 API 验证，验证结束会清空输入，不保存到浏览器。</p>}
  </section>
}
