import { useEffect, useState, type FormEvent } from 'react'
import { Gift, Loader2, Search, Send, User } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { adminRequest } from '@/lib/api'
import type { UserSearchResult, UserSummary, IssuePointsVoucherInput, IssuePointsVoucherResult } from '@/types/user-reward'

type UserRewardPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

export function UserRewardPage({ onLogout, onMenuChange }: UserRewardPageProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [summary, setSummary] = useState<UserSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (selectedUser?.user_id) {
      void loadUserSummary(selectedUser.user_id)
    } else {
      setSummary(null)
    }
  }, [selectedUser])

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
      const data = await adminRequest<{ items: UserSearchResult[] }>(`/api/admin/users/search?${params}`)
      setSearchResults(data.items || [])
      if (!data.items?.length) {
        toast.info('未找到匹配用户')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索用户失败')
    } finally {
      setSearching(false)
    }
  }

  async function loadUserSummary(userID: string) {
    setLoadingSummary(true)
    try {
      const data = await adminRequest<UserSummary>(`/api/admin/users/${encodeURIComponent(userID)}/summary`)
      setSummary(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载用户信息失败')
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }

  function handleSelectUser(user: UserSearchResult) {
    setSelectedUser(user)
    setSearchResults([])
    setQuery('')
  }

  function handleClearSelection() {
    setSelectedUser(null)
    setSummary(null)
    setPoints('')
    setNote('')
  }

  async function handleSendReward() {
    if (!selectedUser) return
    const pointsNum = Number.parseInt(points, 10)
    if (Number.isNaN(pointsNum) || pointsNum <= 0) {
      toast.error('请输入有效的积分数')
      return
    }
    setSending(true)
    try {
      const body: IssuePointsVoucherInput = { points: pointsNum, note: note.trim() }
      await adminRequest<IssuePointsVoucherResult>(`/api/admin/users/${encodeURIComponent(selectedUser.user_id)}/voucher-rewards/points`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.success(`已向 ${selectedUser.nickname || selectedUser.user_id} 发放 ${pointsNum} 积分礼券`)
      setPoints('')
      setNote('')
      setConfirmOpen(false)
      void loadUserSummary(selectedUser.user_id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发放奖励失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='user-rewards' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-8'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>用户奖励</h1>
            <p className='text-sm text-muted-foreground'>搜索用户并发放积分礼券，用户将在「我的礼券」中领取。</p>
          </div>
        </div>

        <div className='grid gap-6 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Search className='size-4' />
                搜索用户
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <form className='flex gap-2' onSubmit={(e) => void searchUsers(e)}>
                <Input
                  placeholder='用户 ID / 昵称 / 手机号 / OpenID'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button type='submit' variant='outline' disabled={searching}>
                  {searching ? <Loader2 className='size-4 animate-spin' /> : <Search className='size-4' />}
                </Button>
              </form>

              {searchResults.length > 0 && (
                <div className='space-y-3'>
                  {searchResults.map((user) => (
                    <button
                      key={user.user_id}
                      type='button'
                      onClick={() => handleSelectUser(user)}
                      className='flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent'
                    >
                      {user.avatar ? (
                        <img src={user.avatar} alt='' className='size-10 shrink-0 rounded-full object-cover' />
                      ) : (
                        <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-muted'>
                          <User className='size-5 text-muted-foreground' />
                        </div>
                      )}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate font-medium'>{user.nickname || '未命名用户'}</span>
                          {user.telephone && <Badge variant='outline'>{user.telephone}</Badge>}
                        </div>
                        <p className='mt-1 truncate text-xs text-muted-foreground'>{user.user_id}</p>
                      </div>
                      <Send className='size-4 shrink-0 text-muted-foreground' />
                    </button>
                  ))}
                </div>
              )}

              {!selectedUser && searchResults.length === 0 && !searching && query.trim() === '' && (
                <div className='rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground'>
                  输入关键词搜索用户后选择要奖励的对象
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Gift className='size-4' />
                发放奖励
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!selectedUser ? (
                <div className='rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground'>
                  请先搜索并选择一位用户
                </div>
              ) : loadingSummary ? (
                <div className='flex items-center justify-center py-12'>
                  <Loader2 className='size-6 animate-spin text-muted-foreground' />
                </div>
              ) : summary ? (
                <div className='space-y-4'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='flex items-center gap-3'>
                      {summary.avatar ? (
                        <img src={summary.avatar} alt='' className='size-10 rounded-full object-cover' />
                      ) : (
                        <div className='flex size-10 items-center justify-center rounded-full bg-muted'>
                          <User className='size-5 text-muted-foreground' />
                        </div>
                      )}
                      <div>
                        <div className='font-medium'>{summary.nickname || '未命名用户'}</div>
                        <div className='text-xs text-muted-foreground'>{summary.user_id}</div>
                      </div>
                    </div>
                    <Button variant='ghost' size='sm' onClick={handleClearSelection}>
                      重新选择
                    </Button>
                  </div>

                  <Separator />

                  <div className='grid grid-cols-2 gap-3 text-sm'>
                    <div className='rounded-md border bg-muted/50 p-3'>
                      <div className='text-xs text-muted-foreground'>注册时间</div>
                      <div className='mt-1 font-medium'>{summary.created_at ? formatDate(summary.created_at) : '-'}</div>
                    </div>
                    <div className='rounded-md border bg-muted/50 p-3'>
                      <div className='text-xs text-muted-foreground'>奖励积分余额</div>
                      <div className='mt-1 font-medium'>{summary.earned_credits_balance}</div>
                    </div>
                    <div className='rounded-md border bg-muted/50 p-3'>
                      <div className='text-xs text-muted-foreground'>会员状态</div>
                      <div className='mt-1 font-medium'>
                        {summary.is_pro ? `Pro · ${summary.current_plan_code || ''}` : '非会员'}
                      </div>
                    </div>
                    <div className='rounded-md border bg-muted/50 p-3'>
                      <div className='text-xs text-muted-foreground'>每日额度</div>
                      <div className='mt-1 font-medium'>{summary.daily_credits}</div>
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='reward-points'>奖励积分</Label>
                    <Input
                      id='reward-points'
                      type='number'
                      min={1}
                      step={1}
                      placeholder='请输入要发放的积分数'
                      value={points}
                      onChange={(e) => setPoints(e.target.value)}
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='reward-note'>备注（可选）</Label>
                    <Input
                      id='reward-note'
                      placeholder='例如：活动奖励、补偿积分'
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>

                  <ConfirmDialog
                    open={confirmOpen}
                    onOpenChange={setConfirmOpen}
                    title='确认发放奖励？'
                    description={`将向 ${summary.nickname || summary.user_id} 发放 ${points || 0} 积分礼券，用户需在「我的礼券」中点击领取。`}
                    confirmLabel='确认发放'
                    confirming={sending}
                    onConfirm={handleSendReward}
                  />

                  <Button
                    className='w-full'
                    disabled={!points || Number.parseInt(points, 10) <= 0}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Send className='mr-2 size-4' />
                    发送奖励
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
