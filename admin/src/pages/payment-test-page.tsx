import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CircleAlert, CreditCard, EyeOff, Loader2, RefreshCcw, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminRequest, displayApiBase } from '@/lib/api'

type PaymentTestPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type PaymentTestSettings = {
  enabled: boolean
  updated_by?: string
  updated_at?: string
}

type PaymentTestPlan = {
  code: string
  name: string
  amount: number
  duration_months: number
  is_active: boolean
  is_visible: boolean
  is_test_plan: boolean
  daily_credits: number
  tier?: string
  period?: string
  sort_order: number
}

type PaymentTestUser = {
  id: string
  user_id: string
  nickname: string
  avatar: string
  telephone: string
  openid: string
  app_openid: string
  note: string
  created_by: string
  created_at?: string
}

type PaymentTestUserSearchResult = {
  user_id: string
  nickname: string
  avatar: string
  telephone: string
  openid: string
  app_openid: string
  created_at?: string
  is_added: boolean
}

type PaymentTestSummary = {
  settings: PaymentTestSettings
  plan: PaymentTestPlan | null
  users: PaymentTestUser[]
}

const testPlanCode = 'test_one_cent_monthly'

export function PaymentTestPage({ onLogout, onMenuChange }: PaymentTestPageProps) {
  const [summary, setSummary] = useState<PaymentTestSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<PaymentTestUserSearchResult[]>([])
  const [busyUserId, setBusyUserId] = useState('')

  const apiBase = displayApiBase()
  const plan = summary?.plan
  const planReady = Boolean(
    plan &&
      plan.code === testPlanCode &&
      Number(plan.amount) === 0.01 &&
      plan.duration_months === 1 &&
      plan.is_active &&
      !plan.is_visible &&
      plan.is_test_plan,
  )
  const enabled = Boolean(summary?.settings.enabled)
  const users = summary?.users || []
  const statusText = useMemo(() => {
    if (!summary) return '未读取'
    if (!planReady) return '测试套餐异常'
    return enabled ? '测试支付已启用' : '测试支付已关闭'
  }, [enabled, planReady, summary])

  useEffect(() => {
    void loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    try {
      const data = await adminRequest<PaymentTestSummary>('/api/admin/payment-test/summary')
      setSummary(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取支付测试配置失败')
    } finally {
      setLoading(false)
    }
  }

  async function updateEnabled(nextEnabled: boolean) {
    setSavingSettings(true)
    try {
      const data = await adminRequest<{ settings: PaymentTestSettings }>('/api/admin/payment-test/settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      setSummary((current) => (current ? { ...current, settings: data.settings } : current))
      toast.success(nextEnabled ? '支付测试已启用' : '支付测试已关闭')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存开关失败')
    } finally {
      setSavingSettings(false)
    }
  }

  async function searchUsers(event?: FormEvent) {
    event?.preventDefault()
    const text = query.trim()
    if (!text) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: text, limit: '20' })
      const data = await adminRequest<{ items: PaymentTestUserSearchResult[] }>(`/api/admin/payment-test/user-search?${params}`)
      setSearchResults(data.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索用户失败')
    } finally {
      setSearching(false)
    }
  }

  async function addUser(userID: string) {
    setBusyUserId(userID)
    try {
      await adminRequest<{ item: PaymentTestUser }>('/api/admin/payment-test/users', {
        method: 'POST',
        body: JSON.stringify({ user_id: userID, note: note.trim() }),
      })
      toast.success('已加入测试名单')
      await loadSummary()
      await searchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入失败')
    } finally {
      setBusyUserId('')
    }
  }

  async function removeUser(userID: string) {
    setBusyUserId(userID)
    try {
      await adminRequest<{ message: string }>(`/api/admin/payment-test/users/${encodeURIComponent(userID)}`, { method: 'DELETE' })
      toast.success('已移出测试名单')
      await loadSummary()
      await searchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除失败')
    } finally {
      setBusyUserId('')
    }
  }

  return (
    <div className='relative z-10 flex min-h-svh gap-6 p-6'>
      <AdminSidebar activeMenu='payment-test' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 flex-1 space-y-6'>
        <header className='flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md'>
          <div>
            <p className='text-sm text-muted-foreground'>API: {apiBase}</p>
            <h1 className='mt-2 text-3xl font-bold tracking-tight'>支付测试</h1>
            <p className='mt-2 text-sm text-muted-foreground'>一分钱会员测试套餐与可购买账号名单</p>
          </div>
          <div className='flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-muted-foreground'>
            {loading ? <Loader2 className='size-4 animate-spin' /> : <CreditCard className='size-4' />}
            {statusText}
          </div>
        </header>

        <section className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]'>
          <div className='rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
            <div className='flex flex-wrap items-start justify-between gap-4'>
              <div>
                <div className='flex items-center gap-2'>
                  <ShieldCheck className='size-5 text-primary' />
                  <h2 className='text-lg font-semibold'>测试支付开关</h2>
                </div>
                <p className='mt-2 text-sm text-muted-foreground'>
                  开启后，只有下方名单内账号可以购买隐藏的一分钱测试套餐。
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <Button variant='outline' aria-label='刷新支付测试状态' title='刷新支付测试状态' onClick={() => void loadSummary()} disabled={loading}>
                  <RefreshCcw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                </Button>
                <Button onClick={() => void updateEnabled(!enabled)} disabled={savingSettings || loading || !planReady}>
                  {savingSettings ? <Loader2 className='size-4 animate-spin' /> : enabled ? '关闭测试' : '启用测试'}
                </Button>
              </div>
            </div>

            <div className='mt-5 grid gap-3 md:grid-cols-3'>
              <InfoTile label='当前状态' value={enabled ? '已启用' : '已关闭'} tone={enabled ? 'success' : 'muted'} />
              <InfoTile label='测试用户' value={`${users.length} 人`} />
              <InfoTile label='最后更新' value={formatDate(summary?.settings.updated_at)} />
            </div>
          </div>

          <div className='rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-lg font-semibold'>测试套餐</h2>
                <p className='mt-1 text-sm text-muted-foreground'>{plan?.code || testPlanCode}</p>
              </div>
              <Badge variant={planReady ? 'default' : 'destructive'}>{planReady ? '正常' : '需迁移'}</Badge>
            </div>
            {plan ? (
              <div className='space-y-3 text-sm'>
                <div className='flex items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>金额</span>
                  <strong>{Number(plan.amount || 0).toFixed(2)} CNY</strong>
                </div>
                <div className='flex items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>周期</span>
                  <strong>{plan.duration_months} 个月</strong>
                </div>
                <div className='flex items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>每日额度</span>
                  <strong>{plan.daily_credits}</strong>
                </div>
                <div className='flex flex-wrap gap-2 pt-2'>
                  <Badge variant={plan.is_active ? 'secondary' : 'destructive'}>{plan.is_active ? '已激活' : '未激活'}</Badge>
                  <Badge variant={plan.is_visible ? 'destructive' : 'outline'}>
                    <EyeOff className='size-3' />
                    {plan.is_visible ? '普通用户可见' : '普通用户隐藏'}
                  </Badge>
                  <Badge variant={plan.is_test_plan ? 'secondary' : 'destructive'}>{plan.is_test_plan ? '测试套餐' : '未标记测试'}</Badge>
                </div>
              </div>
            ) : (
              <div className='flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
                <CircleAlert className='size-4' />
                未找到测试套餐，请先执行数据库迁移。
              </div>
            )}
          </div>
        </section>

        <section className='grid gap-6 xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.1fr)]'>
          <div className='rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-lg font-semibold'>添加测试用户</h2>
                <p className='mt-1 text-sm text-muted-foreground'>可按用户 ID、昵称、手机号、openid 搜索。</p>
              </div>
            </div>
            <form className='space-y-3' onSubmit={(event) => void searchUsers(event)}>
              <div className='flex gap-2'>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='输入用户信息' />
                <Button type='submit' variant='outline' aria-label='搜索用户' title='搜索用户' disabled={searching}>
                  {searching ? <Loader2 className='size-4 animate-spin' /> : <Search className='size-4' />}
                </Button>
              </div>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder='备注，可选' />
            </form>

            <div className='mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1'>
              {searchResults.length === 0 ? (
                <div className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>暂无搜索结果</div>
              ) : (
                searchResults.map((item) => (
                  <UserRow
                    key={item.user_id}
                    user={item}
                    action={
                      <Button
                        size='sm'
                        variant={item.is_added ? 'outline' : 'default'}
                        disabled={item.is_added || busyUserId === item.user_id}
                        onClick={() => void addUser(item.user_id)}
                      >
                        {busyUserId === item.user_id ? <Loader2 className='size-4 animate-spin' /> : <UserPlus className='size-4' />}
                        {item.is_added ? '已加入' : '加入'}
                      </Button>
                    }
                  />
                ))
              )}
            </div>
          </div>

          <div className='rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-lg font-semibold'>当前测试名单</h2>
                <p className='mt-1 text-sm text-muted-foreground'>名单内账号才可以购买隐藏测试套餐。</p>
              </div>
              <Badge variant='secondary'>{users.length} 人</Badge>
            </div>

            <div className='max-h-[60vh] space-y-2 overflow-y-auto pr-1'>
              {users.length === 0 ? (
                <div className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>还没有测试用户</div>
              ) : (
                users.map((item) => (
                  <UserRow
                    key={item.user_id}
                    user={item}
                    meta={item.note || `加入人：${item.created_by || '-'}`}
                    action={
                      <Button variant='outline' size='sm' disabled={busyUserId === item.user_id} onClick={() => void removeUser(item.user_id)}>
                        {busyUserId === item.user_id ? <Loader2 className='size-4 animate-spin' /> : <Trash2 className='size-4' />}
                        移除
                      </Button>
                    }
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function InfoTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'muted' }) {
  const toneClass = tone === 'success' ? 'text-primary' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'
  return (
    <div className='rounded-xl border bg-background/60 p-4'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

function UserRow({
  user,
  action,
  meta,
}: {
  user: PaymentTestUser | PaymentTestUserSearchResult
  action: ReactNode
  meta?: string
}) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-xl border bg-background/50 p-3'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='max-w-[180px] truncate text-sm font-semibold'>{user.nickname || '未命名用户'}</span>
          {user.telephone && <Badge variant='outline'>{user.telephone}</Badge>}
        </div>
        <p className='mt-1 truncate text-xs text-muted-foreground'>{user.user_id}</p>
        <p className='mt-1 truncate text-xs text-muted-foreground'>{meta || user.app_openid || user.openid || formatDate(user.created_at)}</p>
      </div>
      <div className='shrink-0'>{action}</div>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}
