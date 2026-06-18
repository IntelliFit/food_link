import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, Flag, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar } from '@/components/admin-sidebar'
import type { AdminMenuId } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { adminRequest } from '@/lib/api'
import { cn } from '@/lib/utils'

type FeedReportStatus = 'pending' | 'resolved' | 'rejected'
type FeedReportTargetType = 'food_record' | 'exercise_log' | 'circle_post'

type FeedReportItem = {
  id: string
  reporter_user_id: string
  reporter_nickname: string
  reporter_avatar: string
  reported_user_id: string
  reported_nickname: string
  reported_avatar: string
  target_type: FeedReportTargetType
  target_id: string
  reason: string
  reason_name: string
  extra_content: string
  status: FeedReportStatus
  resolution_note: string
  reward_credits: number
  reward_ledger_id?: string
  handled_by?: string
  handled_at?: string
  created_at: string
  updated_at: string
}

type FeedReportTargetSnapshot = {
  title: string
  body: string
  description: string
  image_urls: string[]
  author_id: string
  created_at?: string
}

type FeedReportDetailPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type ConfirmAction = 'delete-report' | 'delete-target' | null

const statusLabels: Record<FeedReportStatus, string> = {
  pending: '待处理',
  resolved: '已处理',
  rejected: '已驳回',
}

const reasonLabels: Record<string, string> = {
  spam: '垃圾广告',
  porn: '色情低俗',
  illegal: '违法违规',
  abuse: '人身攻击',
  other: '其他',
}

const targetTypeLabels: Record<string, string> = {
  food_record: '饮食记录',
  exercise_log: '运动记录',
  circle_post: '圈子动态',
}

const statusBadgeClass: Record<FeedReportStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400',
  rejected: 'border-border bg-muted text-muted-foreground dark:bg-muted/50',
}

const transitionOptions: Record<FeedReportStatus, FeedReportStatus[]> = {
  pending: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制${label}`)
  } catch {
    toast.error(`复制${label}失败，请手动复制`)
  }
}

export function FeedReportDetailPage({ onLogout, onMenuChange }: FeedReportDetailPageProps) {
  const navigate = useNavigate()
  const { reportId } = useParams<{ reportId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [item, setItem] = useState<FeedReportItem | null>(null)
  const [target, setTarget] = useState<FeedReportTargetSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingTarget, setDeletingTarget] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')
  const [rewardCredits, setRewardCredits] = useState('0')
  const [removeTargetOnResolve, setRemoveTargetOnResolve] = useState(true)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)

  useEffect(() => {
    if (!reportId) {
      navigate('/feed-reports')
      return
    }
    void loadReport(reportId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  useEffect(() => {
    if (!item) return
    const copyType = searchParams.get('copy')
    if (!copyType) return

    const copyMap: Record<string, { text: string; label: string }> = {
      reporter: { text: item.reporter_user_id, label: '举报人 ID' },
      reported: { text: item.reported_user_id, label: '被举报人 ID' },
      target: { text: item.target_id, label: '动态 ID' },
    }
    const copyItem = copyMap[copyType]
    if (!copyItem) return

    void copyText(copyItem.text, copyItem.label)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  async function loadReport(id: string) {
    setLoading(true)
    try {
      const data = await adminRequest<{ item: FeedReportItem; target: FeedReportTargetSnapshot }>(
        `/api/admin/feed-reports/${encodeURIComponent(id)}`,
      )
      setItem(data.item)
      setTarget(data.target)
      setResolutionNote(data.item.resolution_note || '')
      setRewardCredits(String(data.item.reward_credits ?? 0))
      setRemoveTargetOnResolve(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载举报详情失败')
      navigate('/feed-reports')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(nextStatus: FeedReportStatus) {
    if (!item) return
    const trimmedRewardCredits = rewardCredits.trim()
    const parsedRewardCredits = Number(rewardCredits)
    if (nextStatus === 'resolved' && (trimmedRewardCredits === '' || !Number.isInteger(parsedRewardCredits) || parsedRewardCredits < 0)) {
      toast.error('处理为已处理时必须选择奖励积分，可填写 0')
      return
    }
    if (nextStatus === 'resolved' && removeTargetOnResolve && canDeleteTargetContent(item.target_type)) {
      setConfirmAction('delete-target')
      return
    }
    setUpdating(true)
    try {
      const data = await adminRequest<{ item: FeedReportItem }>(
        `/api/admin/feed-reports/${encodeURIComponent(item.id)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: nextStatus,
            resolution_note: resolutionNote,
            reward_credits: nextStatus === 'resolved' ? parsedRewardCredits : undefined,
          }),
        },
      )
      setItem(data.item)
      setResolutionNote(data.item.resolution_note || '')
      setRewardCredits(String(data.item.reward_credits ?? 0))
      toast.success('状态已更新')
      if (data.item.status === 'resolved' || data.item.status === 'rejected') {
        toast.info('已发送受理结果系统消息给举报者')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '状态更新失败')
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete() {
    if (!item) return
    setDeleting(true)
    try {
      await adminRequest(`/api/admin/feed-reports/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      toast.success('已删除')
      setConfirmAction(null)
      navigate('/feed-reports')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteTargetContent() {
    if (!item || !canDeleteTargetContent(item.target_type)) return
    const trimmedRewardCredits = rewardCredits.trim()
    const parsedRewardCredits = Number(rewardCredits)
    if (trimmedRewardCredits === '' || !Number.isInteger(parsedRewardCredits) || parsedRewardCredits < 0) {
      toast.error('删除并处理举报时必须选择奖励积分，可填写 0')
      return
    }
    setDeletingTarget(true)
    try {
      const data = await adminRequest<{ item: FeedReportItem }>(
        `/api/admin/feed-reports/${encodeURIComponent(item.id)}/delete-target`,
        {
          method: 'POST',
          body: JSON.stringify({ resolution_note: resolutionNote, reward_credits: parsedRewardCredits }),
        },
      )
      setItem(data.item)
      setResolutionNote(data.item.resolution_note || resolutionNote || defaultDeleteTargetResolutionNote(item.target_type))
      setRewardCredits(String(data.item.reward_credits ?? 0))
      setTarget(null)
      toast.success('被举报内容已从圈子中移除')
      setConfirmAction(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除被举报内容失败')
    } finally {
      setDeletingTarget(false)
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1200px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='feed-reports' onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className='min-w-0 space-y-4 pb-8'>
        <div className='flex items-center gap-3'>
          <Button variant='outline' size='sm' onClick={() => navigate('/feed-reports')}>
            <ArrowLeft className='mr-1 size-4' />
            返回列表
          </Button>
          <h1 className='text-2xl font-semibold tracking-tight'>举报详情</h1>
        </div>

        {loading || !item ? (
          <LoadingSkeleton />
        ) : (
          <div className='grid gap-4 lg:grid-cols-[1fr_380px]'>
            <div className='space-y-4'>
              <Card>
                <CardHeader>
                  <div className='flex items-start justify-between gap-4'>
                    <div className='space-y-1'>
                      <CardTitle className='flex items-center gap-2 text-lg'>
                        <Flag className='size-5' />
                        举报信息
                      </CardTitle>
                      <CardDescription>举报 ID：{item.id}</CardDescription>
                    </div>
                    <Badge variant='outline' className={cn(statusBadgeClass[item.status], 'font-normal')}>
                      {statusLabels[item.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <InfoGrid
                    items={[
                      { label: '举报类型', value: targetTypeLabels[item.target_type] || item.target_type },
                      { label: '被举报对象 ID', value: item.target_id, mono: true, copyable: true },
                      { label: '举报原因', value: reasonLabels[item.reason] || item.reason },
                      { label: '奖励积分', value: `${item.reward_credits ?? 0}` },
                      { label: '提交时间', value: new Date(item.created_at).toLocaleString('zh-CN') },
                      { label: '更新时间', value: new Date(item.updated_at).toLocaleString('zh-CN') },
                    ]}
                  />

                  <Separator />

                  <div className='space-y-2'>
                    <Label>举报人</Label>
                    <UserInfo
                      nickname={item.reporter_nickname}
                      userId={item.reporter_user_id}
                      avatar={item.reporter_avatar}
                      label='举报人 ID'
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label>被举报人</Label>
                    <UserInfo
                      nickname={item.reported_nickname}
                      userId={item.reported_user_id}
                      avatar={item.reported_avatar}
                      label='被举报人 ID'
                    />
                  </div>

                  <Separator />

                  <div className='space-y-2'>
                    <Label>补充说明</Label>
                    <div className='rounded-md border bg-muted/50 p-3 text-sm whitespace-pre-wrap'>
                      {item.extra_content || '无'}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-lg'>被举报内容摘要</CardTitle>
                  <CardDescription>来自动态/记录的目标快照</CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {!target ? (
                    <div className='text-sm text-muted-foreground'>无法加载被举报内容</div>
                  ) : (
                    <>
                      {target.title && <div className='font-medium'>{target.title}</div>}
                      {target.body && <div className='text-muted-foreground'>{target.body}</div>}
                      {target.description && <div className='text-muted-foreground'>{target.description}</div>}
                      {target.image_urls && target.image_urls.length > 0 && (
                        <div className='flex flex-wrap gap-2 pt-1'>
                          {target.image_urls.map((url, idx) => (
                            <a key={idx} href={url} target='_blank' rel='noreferrer'>
                              <img src={url} alt='' className='h-24 w-24 rounded-md object-cover' />
                            </a>
                          ))}
                        </div>
                      )}
                      {target.created_at && (
                        <div className='text-xs text-muted-foreground'>
                          发布时间：{new Date(target.created_at).toLocaleString('zh-CN')}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg'>处理操作</CardTitle>
                  <CardDescription>更新举报受理状态并填写处理说明</CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3'>
                    <div>
                      <div className='text-sm font-medium'>当前状态</div>
                      <div className='mt-1 text-xs text-muted-foreground'>根据举报是否属实做出处理结论</div>
                    </div>
                    <Badge variant='outline' className={cn('shrink-0', statusBadgeClass[item.status])}>
                      {statusLabels[item.status]}
                    </Badge>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='reward-credits'>奖励积分</Label>
                    <Input
                      id='reward-credits'
                      type='number'
                      min={0}
                      step={1}
                      value={rewardCredits}
                      onChange={(event) => setRewardCredits(event.target.value)}
                      disabled={item.status === 'resolved' || item.status === 'rejected'}
                    />
                    <p className='text-xs text-muted-foreground'>
                      处理为已处理时必填；可填 0，表示本次不发放奖励。
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='resolution-note'>处理说明</Label>
                    <Textarea
                      id='resolution-note'
                      value={resolutionNote}
                      onChange={(event) => setResolutionNote(event.target.value)}
                      placeholder='填写处理说明，会随受理结果发送给举报者（可选）'
                      rows={6}
                      disabled={item.status === 'resolved' || item.status === 'rejected'}
                    />
                  </div>

                  {canDeleteTargetContent(item.target_type) && item.status !== 'resolved' && item.status !== 'rejected' ? (
                    <label className='flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm'>
                      <input
                        type='checkbox'
                        className='mt-1'
                        checked={removeTargetOnResolve}
                        onChange={(event) => setRemoveTargetOnResolve(event.target.checked)}
                      />
                      <span>
                        <span className='block font-medium'>同时从圈子中移除被举报内容</span>
                        <span className='block text-xs text-muted-foreground'>
                          默认执行下架并清理点赞、评论和互动通知；取消勾选则只标记举报为已处理。
                        </span>
                      </span>
                    </label>
                  ) : null}

                  {item.status === 'resolved' || item.status === 'rejected' ? (
                    <div className='rounded-md border bg-muted/50 p-3 text-sm space-y-1'>
                      <div>
                        <span className='text-muted-foreground'>奖励积分：</span>
                        <span className='font-medium'>{item.reward_credits ?? 0}</span>
                      </div>
                      <div>
                        <span className='text-muted-foreground'>处理人：</span>
                        <span className='font-medium'>{item.handled_by || '-'}</span>
                      </div>
                      <div>
                        <span className='text-muted-foreground'>处理时间：</span>
                        <span className='font-medium'>
                          {item.handled_at ? new Date(item.handled_at).toLocaleString('zh-CN') : '-'}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {transitionOptions[item.status].length > 0 && (
                    <div className='grid gap-2 sm:grid-cols-2'>
                      <Button
                        className='w-full'
                        onClick={() => void updateStatus('resolved')}
                        disabled={updating}
                      >
                        {updating ? <Loader2 className='mr-1 size-4 animate-spin' /> : <Save className='mr-1 size-4' />}
                        属实，采纳处理
                      </Button>
                      <Button
                        variant='outline'
                        className='w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
                        onClick={() => void updateStatus('rejected')}
                        disabled={updating}
                      >
                        驳回举报
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-lg text-destructive'>危险操作</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {canDeleteTargetContent(item.target_type) ? (
                    <Button
                      variant='destructive'
                      className='w-full'
                      onClick={() => setConfirmAction('delete-target')}
                      disabled={deletingTarget || !target}
                    >
                      {deletingTarget ? <Loader2 className='mr-1 size-4 animate-spin' /> : <Trash2 className='mr-1 size-4' />}
                      从圈子中移除被举报内容
                    </Button>
                  ) : null}
                  <Button variant='destructive' className='w-full' onClick={() => setConfirmAction('delete-report')} disabled={deleting}>
                    {deleting ? <Loader2 className='mr-1 size-4 animate-spin' /> : <Trash2 className='mr-1 size-4' />}
                    删除举报记录
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
      <ConfirmDialog
        open={confirmAction === 'delete-target'}
        onOpenChange={(open) => setConfirmAction(open ? 'delete-target' : null)}
        title='移除被举报内容？'
        description='该内容会从圈子中移除，相关点赞、评论和互动通知也会同步清理。'
        confirmLabel='移除内容'
        variant='destructive'
        confirming={deletingTarget}
        onConfirm={handleDeleteTargetContent}
      />
      <ConfirmDialog
        open={confirmAction === 'delete-report'}
        onOpenChange={(open) => setConfirmAction(open ? 'delete-report' : null)}
        title='删除举报记录？'
        description='删除后不可恢复，只会删除举报工单记录，不会自动恢复或移除被举报内容。'
        confirmLabel='删除记录'
        variant='destructive'
        confirming={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function canDeleteTargetContent(targetType: string) {
  return targetType === 'circle_post' || targetType === 'food_record' || targetType === 'exercise_log'
}

function defaultDeleteTargetResolutionNote(targetType: string) {
  return targetType === 'circle_post' ? '已删除被举报的圈子内容。' : '已从圈子中移除被举报内容。'
}

function InfoGrid({ items }: { items: Array<{ label: string; value: string; mono?: boolean; copyable?: boolean }> }) {
  return (
    <div className='grid gap-3 text-sm'>
      {items.map((item) => (
        <div key={item.label} className='flex items-center justify-between gap-4'>
          <span className='text-muted-foreground'>{item.label}</span>
          <div className='flex items-center gap-2'>
            <span className={cn('text-right', item.mono && 'font-mono')}>{item.value}</span>
            {item.copyable && (
              <Button variant='ghost' size='icon' className='size-6' onClick={() => copyText(item.value, item.label)}>
                <Copy className='size-3' />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function UserInfo({ nickname, userId, avatar, label }: { nickname: string; userId: string; avatar: string; label: string }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-md border bg-muted/50 p-3'>
      <div className='flex min-w-0 items-center gap-3'>
        {avatar ? (
          <img src={avatar} alt='' className='size-10 rounded-full object-cover' />
        ) : (
          <div className='flex size-10 items-center justify-center rounded-full bg-muted text-sm font-medium'>
            {(nickname || userId).slice(0, 1)}
          </div>
        )}
        <div className='min-w-0'>
          <div className='truncate font-medium'>{nickname || '未知用户'}</div>
          <div className='truncate font-mono text-xs text-muted-foreground'>{userId}</div>
        </div>
      </div>
      <Button variant='ghost' size='icon' className='size-6 shrink-0' onClick={() => copyText(userId, label)}>
        <Copy className='size-3' />
      </Button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className='grid gap-4 lg:grid-cols-[1fr_380px]'>
      <div className='space-y-4'>
        <Card>
          <CardHeader>
            <Skeleton className='h-6 w-32' />
          </CardHeader>
          <CardContent className='space-y-4'>
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-20 w-full' />
          </CardContent>
        </Card>
      </div>
      <div className='space-y-4'>
        <Card>
          <CardContent className='space-y-4 pt-6'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-10 w-full' />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
