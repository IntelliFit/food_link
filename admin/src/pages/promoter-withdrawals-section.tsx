import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import type { ActionSpec } from '@/components/action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminRequest } from '@/lib/api'
import { formatTime, shortId } from '@/lib/format'
import { PROMOTER_STATUS_LABEL, WITHDRAWAL_STATUS_LABEL, yuan } from '@/lib/promoter-format'
import type { AdminWithdrawal, Page, WithdrawalStatus } from '@/types/promoter'

const PAGE_SIZE = 20
const FILTERS: Array<{ value: WithdrawalStatus | ''; label: string }> = [
  { value: 'reviewing', label: '待审核' },
  { value: 'approved', label: '待打款' },
  { value: 'succeeded', label: '已打款' },
  { value: 'rejected', label: '已驳回' },
  { value: 'failed', label: '打款失败' },
  { value: '', label: '全部' },
]

type Props = { onAction: (spec: ActionSpec) => void }

export function PromoterWithdrawalsSection({ onAction }: Props) {
  const [status, setStatus] = useState<WithdrawalStatus | ''>('reviewing')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<AdminWithdrawal>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) })
      setData(await adminRequest<Page<AdminWithdrawal>>(`/api/admin/promoter-withdrawals?${params}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取提现列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function post(item: AdminWithdrawal, action: 'review' | 'payout', body: object, success: string) {
    try {
      await adminRequest(`/api/admin/promoter-withdrawals/${encodeURIComponent(item.id)}/${action}`, { method: 'POST', body: JSON.stringify(body) })
      toast.success(success)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
      throw error
    }
  }

  function approve(item: AdminWithdrawal) {
    onAction({
      title: `通过 ${item.nickname || '推广员'} 的提现 ${yuan(item.amount_cents)}？`,
      description: '通过后请在微信支付商户平台或微信转账给对方，转完回到这里点「标记已打款」。推广员当前状态和余额会再校验一次。',
      confirmLabel: '通过',
      noteLabel: '审核备注',
      run: ({ note }) => post(item, 'review', { approve: true, note }, '已通过，等待打款'),
    })
  }

  function reject(item: AdminWithdrawal) {
    onAction({
      title: `驳回提现 ${yuan(item.amount_cents)}？`,
      description: '金额会退回推广员的可提现余额。',
      confirmLabel: '驳回',
      destructive: true,
      noteLabel: '驳回原因（推广员可见）',
      noteRequired: true,
      run: ({ note }) => post(item, 'review', { approve: false, note }, '已驳回'),
    })
  }

  function markPaid(item: AdminWithdrawal) {
    onAction({
      title: `确认已给 ${item.nickname || '推广员'} 打款 ${yuan(item.net_amount_cents)}？`,
      description: <>
        {item.promoter_status !== 'active'
          ? <p className='font-medium text-destructive'>推广员当前{PROMOTER_STATUS_LABEL[item.promoter_status]}，请先确认是否还应打款。</p>
          : null}
        {item.available_cents < 0
          ? <p className='font-medium text-destructive'>推广员有退款扣回，当前余额 {yuan(item.available_cents)}，请先确认是否还应打款。</p>
          : null}
        <p>只在钱已经转出后标记，标记后推广员看到「已到账」，不能撤回。</p>
      </>,
      confirmLabel: '标记已打款',
      noteLabel: '打款备注，例如商户平台转账单号',
      confirmCheckLabel: '我已核对收款人和金额，钱已转出',
      run: ({ note }) => post(item, 'payout', { succeeded: true, note }, '已标记打款'),
    })
  }

  function markFailed(item: AdminWithdrawal) {
    onAction({
      title: `标记提现 ${yuan(item.amount_cents)} 打款失败？`,
      description: '金额会退回推广员的可提现余额，推广员可以重新发起。',
      confirmLabel: '标记失败',
      destructive: true,
      noteLabel: '失败原因（推广员可见）',
      noteRequired: true,
      run: ({ note }) => post(item, 'payout', { succeeded: false, note }, '已标记失败'),
    })
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {FILTERS.map((filter) => (
          <Button key={filter.label} size='sm' variant={status === filter.value ? 'default' : 'outline'} onClick={() => { setStatus(filter.value); setPage(1) }}>
            {filter.label}
          </Button>
        ))}
        <Button size='sm' variant='ghost' onClick={() => void load()} disabled={loading} aria-label='刷新'>
          {loading ? <Loader2 className='size-4 animate-spin' /> : <RefreshCw className='size-4' />}
        </Button>
      </div>

      <div className='rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>申请时间</TableHead>
              <TableHead>推广员</TableHead>
              <TableHead className='text-right'>金额</TableHead>
              <TableHead className='text-right'>当前可提现</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>处理记录</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className='py-10 text-center text-muted-foreground'>{loading ? '' : '没有符合条件的提现'}</TableCell></TableRow>
            ) : data.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className='whitespace-nowrap'>{item.created_at ? formatTime(item.created_at, true) : '-'}</TableCell>
                <TableCell>
                  <div className='font-medium'>{item.nickname || '未命名用户'}</div>
                  <div className='text-xs text-muted-foreground'>{item.promo_code} · {PROMOTER_STATUS_LABEL[item.promoter_status]} · {shortId(item.user_id)}</div>
                </TableCell>
                <TableCell className='text-right font-medium'>{yuan(item.amount_cents)}</TableCell>
                <TableCell className={`text-right ${item.available_cents < 0 ? 'text-destructive' : ''}`}>{yuan(item.available_cents)}</TableCell>
                <TableCell><Badge variant={item.status === 'reviewing' || item.status === 'approved' ? 'default' : 'outline'}>{WITHDRAWAL_STATUS_LABEL[item.status]}</Badge></TableCell>
                <TableCell className='max-w-[240px] text-xs text-muted-foreground'>
                  {item.reviewed_by ? <div>{item.reviewed_by}{item.reviewed_at ? ` · ${formatTime(item.reviewed_at, true)}` : ''}</div> : null}
                  {item.review_note ? <div className='truncate' title={item.review_note}>{item.review_note}</div> : null}
                  {item.fail_reason ? <div className='truncate text-destructive' title={item.fail_reason}>{item.fail_reason}</div> : null}
                </TableCell>
                <TableCell className='text-right'>
                  <div className='flex justify-end gap-2'>
                    {item.status === 'reviewing' ? <>
                      <Button size='sm' onClick={() => approve(item)}>通过</Button>
                      <Button size='sm' variant='outline' onClick={() => reject(item)}>驳回</Button>
                    </> : null}
                    {item.status === 'approved' && item.payout_method === 'manual' ? <>
                      <Button size='sm' onClick={() => markPaid(item)}>标记已打款</Button>
                      <Button size='sm' variant='outline' onClick={() => markFailed(item)}>标记失败</Button>
                    </> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-end gap-2 text-sm text-muted-foreground'>
        <span>共 {data.total} 笔 · 第 {page}/{pages} 页</span>
        <Button size='sm' variant='outline' disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Button size='sm' variant='outline' disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>
    </section>
  )
}
