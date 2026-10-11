import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Megaphone, Plus, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminRequest } from '@/lib/api'

type Notice = {
  id: string
  title: string
  content: string
  min_version: string
  status: 'draft' | 'published' | 'withdrawn'
  published_at: string | null
  acknowledged_count: number
}
type Draft = Pick<Notice, 'title' | 'content' | 'min_version'>
const emptyDraft: Draft = { title: '', content: '', min_version: '' }
const labels = { draft: '草稿', published: '已发布', withdrawn: '已撤回' }

export function ProductUpdatesPage({ onLogout, onMenuChange }: {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}) {
  const [items, setItems] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const result = await adminRequest<{ items: Notice[] }>('/product-updates')
      setItems(result.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知读取失败')
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await adminRequest(`/product-updates${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(draft),
      })
      toast.success('草稿已保存，发布后用户才能看到')
      setEditingId(''); setDraft(emptyDraft)
      await reload()
    } catch (err) { toast.error(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy(false) }
  }
  async function transition(item: Notice, action: 'publish' | 'withdraw') {
    if (busy) return
    const prompt = action === 'publish'
      ? `发布「${item.title}」？版本 ${item.min_version} 及以上的用户下次打开小程序时须确认。发布后正文不可修改。`
      : `撤回「${item.title}」？用户将不再收到这条通知，已有确认记录会保留。`
    if (!window.confirm(prompt)) return
    setBusy(true)
    try {
      await adminRequest(`/product-updates/${item.id}/${action}`, { method: 'POST', body: '{}' })
      toast.success(action === 'publish' ? '通知已发布' : '通知已撤回')
      if (editingId === item.id) { setEditingId(''); setDraft(emptyDraft) }
      await reload()
    } catch (err) { toast.error(err instanceof Error ? err.message : '操作失败') }
    finally { setBusy(false) }
  }
  function edit(item: Notice, copy = false) {
    setEditingId(copy ? '' : item.id)
    setDraft({ title: item.title, content: item.content, min_version: item.min_version })
  }

  return (
    <div className='relative z-10 mx-auto flex max-w-[1600px] gap-6 p-4 lg:p-6'>
      <AdminSidebar activeMenu='product-updates' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 flex-1 space-y-6'>
        <header className='flex items-start justify-between gap-4'>
          <div>
            <h1 className='flex items-center gap-2 text-2xl font-bold'><Megaphone className='size-6' />产品更新通知</h1>
            <p className='mt-2 text-sm text-muted-foreground'>用户打开小程序时逐条确认。登录用户跨设备同步确认状态，游客在当前设备保存。</p>
          </div>
          <Button variant='outline' disabled={loading || busy} onClick={() => void reload()}><RefreshCcw className='size-4' />刷新</Button>
        </header>
        <div className='grid items-start gap-6 xl:grid-cols-2'>
          <section className='rounded-xl border bg-card p-5'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='font-semibold'>{editingId ? '编辑草稿' : '新增通知'}</h2>
              <Button variant='ghost' disabled={busy} onClick={() => { setEditingId(''); setDraft(emptyDraft) }}><Plus className='size-4' />新建</Button>
            </div>
            <form className='space-y-4' onSubmit={save}>
              <label className='block space-y-2 text-sm'>
                <span>标题</span>
                <Input required maxLength={32} value={draft.title} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder='例如：现在可以邀请好友一起吃饭了' />
              </label>
              <label className='block space-y-2 text-sm'>
                <span>最低小程序版本</span>
                <Input required pattern='(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})' value={draft.min_version} disabled={busy} onChange={e => setDraft({ ...draft, min_version: e.target.value })} placeholder='例如 4.6.12，填写包含这项功能的版本' />
              </label>
              <label className='block space-y-2 text-sm'>
                <span>更新说明（最多 1200 字）</span>
                <textarea required maxLength={1200} rows={8} disabled={busy} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} className='w-full rounded-md border bg-background p-3 text-sm' placeholder={'说明新增了什么、从哪里进入、怎么使用。\n每条通知聚焦一项更新，方便用户阅读。'} />
              </label>
              <Button type='submit' disabled={busy}>{busy && <Loader2 className='size-4 animate-spin' />}保存草稿</Button>
            </form>
            <div className='mt-5 rounded-lg border bg-muted/30 p-4'>
              <p className='text-xs text-muted-foreground'>小程序弹窗内容预览</p>
              <h3 className='mt-3 font-semibold'>{draft.title || '通知标题'}</h3>
              <p className='mt-2 whitespace-pre-wrap break-words text-sm'>{draft.content || '更新说明将显示在这里'}</p>
              <div className='mt-4 text-center text-sm font-semibold text-primary'>我知道了</div>
            </div>
          </section>
          <section className='space-y-3'>
            <h2 className='font-semibold'>通知记录</h2>
            {loading ? <div className='flex justify-center p-10'><Loader2 className='size-6 animate-spin' aria-label='读取通知' /></div> : error ? (
              <div className='rounded-xl border p-5 text-destructive'>{error}<Button variant='outline' className='ml-3' onClick={() => void reload()}>重试</Button></div>
            ) : items.length === 0 ? <p className='rounded-xl border p-5 text-sm text-muted-foreground'>还没有产品更新通知，请先创建草稿。</p> : [...items].reverse().map(item => (
              <article key={item.id} className='space-y-3 rounded-xl border bg-card p-5'>
                <div className='flex items-start justify-between gap-3'><h3 className='font-semibold'>{item.title}</h3><span className='shrink-0 rounded bg-muted px-2 py-1 text-xs'>{labels[item.status]}</span></div>
                <p className='max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm'>{item.content}</p>
                <p className='text-xs text-muted-foreground'>版本 ≥ {item.min_version} · 已确认 {item.acknowledged_count} 人{item.published_at ? ` · ${new Date(item.published_at).toLocaleString('zh-CN')}` : ''}</p>
                <div className='flex flex-wrap gap-2'>
                  {item.status === 'draft' && <><Button variant='outline' disabled={busy} onClick={() => edit(item)}>编辑</Button><Button disabled={busy} onClick={() => void transition(item, 'publish')}>发布通知</Button></>}
                  {item.status === 'published' && <Button variant='outline' disabled={busy} onClick={() => void transition(item, 'withdraw')}>撤回</Button>}
                  <Button variant='ghost' disabled={busy} onClick={() => edit(item, true)}>复制为新草稿</Button>
                </div>
              </article>
            ))}
          </section>
        </div>
      </main>
    </div>
  )
}
