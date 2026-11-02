import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import type { ActionSpec } from '@/components/action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminRequest } from '@/lib/api'
import { formatTime, shortId } from '@/lib/format'
import { PROMOTER_STATUS_LABEL, parseRateInput, promoterStatusActions, ratePercent, yuan } from '@/lib/promoter-format'
import { PromoterCommissionsPanel } from '@/pages/promoter-commissions-panel'
import type { AdminPromoter, Page, PromoterStatus } from '@/types/promoter'

const PAGE_SIZE = 20
const FILTERS: Array<{ value: PromoterStatus | ''; label: string }> = [
  { value: 'pending_review', label: '待审核' },
  { value: 'active', label: '正常' },
  { value: 'suspended', label: '已暂停' },
  { value: 'rejected', label: '已驳回' },
  { value: 'terminated', label: '已终止' },
  { value: '', label: '全部' },
]

type Props = { onAction: (spec: ActionSpec) => void }

export function PromoterListSection({ onAction }: Props) {
  const [status, setStatus] = useState<PromoterStatus | ''>('pending_review')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<AdminPromoter>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<AdminPromoter | null>(null)

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) })
      setData(await adminRequest<Page<AdminPromoter>>(`/api/admin/promoters?${params}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取推广员失败')
    } finally {
      setLoading(false)
    }
  }

  async function send(item: AdminPromoter, path: string, method: 'POST' | 'PUT', body: object, success: string) {
    try {
      await adminRequest(`/api/admin/promoters/${encodeURIComponent(item.id)}/${path}`, { method, body: JSON.stringify(body) })
      toast.success(success)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
      throw error
    }
  }

  function rateFrom(raw: string): number | null {
    const rate = parseRateInput(raw)
    if (rate === undefined) {
      toast.error('比例请填 0 到 100 之间的数字，最多两位小数')
      throw new Error('invalid rate')
    }
    return rate
  }

  function approve(item: AdminPromoter) {
    onAction({
      title: `通过 ${item.nickname || '该用户'} 的推广员申请？`,
      description: item.apply_note ? `申请说明：${item.apply_note}` : '用户没有填写申请说明。',
      confirmLabel: '通过',
      rateLabel: '个人佣金比例（%）',
      noteLabel: '审核备注',
      confirmCheckLabel: '已核实对方的真实姓名和联系方式（用于打款和报税）',
      run: async ({ note, rate }) => {
        const rateBps = rateFrom(rate)
        await send(item, 'review', 'POST', { approve: true, real_name_confirmed: true, note, ...(rateBps === null ? {} : { rate_bps: rateBps }) }, '已通过，推广码已生效')
      },
    })
  }

  function reject(item: AdminPromoter) {
    onAction({
      title: `驳回 ${item.nickname || '该用户'} 的申请？`,
      description: '用户可以修改后重新申请。',
      confirmLabel: '驳回',
      destructive: true,
      noteLabel: '驳回原因（用户可见）',
      noteRequired: true,
      run: ({ note }) => send(item, 'review', 'POST', { approve: false, note }, '已驳回'),
    })
  }

  function changeStatus(item: AdminPromoter, target: PromoterStatus, label: string, destructive: boolean) {
    const effect: Partial<Record<PromoterStatus, string>> = {
      suspended: '暂停后新订单照常计佣，但不能提现；待审核的提现也不能通过。',
      active: '恢复后可以正常提现。',
      terminated: '终止后新订单不再计佣，推广码失效，且不能恢复。已有余额需要人工处理。',
    }
    onAction({
      title: `${label}推广员 ${item.nickname || item.promo_code}？`,
      description: effect[target],
      confirmLabel: label,
      destructive,
      noteLabel: '原因',
      run: ({ note }) => send(item, 'status', 'POST', { status: target, note }, `已${label}`),
    })
  }

  function changeRate(item: AdminPromoter) {
    onAction({
      title: `调整 ${item.nickname || item.promo_code} 的佣金比例`,
      description: '只影响之后同步到的订单，已生成的佣金不变。留空恢复默认比例。',
      confirmLabel: '保存',
      rateLabel: '个人佣金比例（%）',
      initialRate: item.commission_rate_bps == null ? '' : String(item.commission_rate_bps / 100),
      run: async ({ rate }) => {
        await send(item, 'rate', 'PUT', { rate_bps: rateFrom(rate) }, '比例已更新')
      },
    })
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {FILTERS.map((filter) => (
          <Button key={filter.label} size='sm' variant={status === filter.value ? 'default' : 'outline'} onClick={() => { setStatus(filter.value); setPage(1); setSelected(null) }}>
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
              <TableHead>用户</TableHead>
              <TableHead>推广码</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>比例</TableHead>
              <TableHead className='text-right'>可提现 / 冻结中 / 已提现</TableHead>
              <TableHead className='text-right'>用户 / 订单</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className='py-10 text-center text-muted-foreground'>{loading ? '' : '没有符合条件的推广员'}</TableCell></TableRow>
            ) : data.items.map((item) => (
              <TableRow key={item.id} className={selected?.id === item.id ? 'bg-muted/50' : ''}>
                <TableCell className='whitespace-nowrap'>{item.created_at ? formatTime(item.created_at, true) : '-'}</TableCell>
                <TableCell className='max-w-[220px]'>
                  <div className='font-medium'>{item.nickname || '未命名用户'}</div>
                  <div className='text-xs text-muted-foreground'>{shortId(item.user_id)}</div>
                  {item.apply_note ? <div className='truncate text-xs text-muted-foreground' title={item.apply_note}>{item.apply_note}</div> : null}
                  {item.review_note ? <div className='truncate text-xs text-muted-foreground' title={item.review_note}>备注：{item.review_note}</div> : null}
                </TableCell>
                <TableCell className='font-mono'>{item.status === 'pending_review' || item.status === 'rejected' ? '-' : item.promo_code}</TableCell>
                <TableCell><Badge variant={item.status === 'pending_review' ? 'default' : 'outline'}>{PROMOTER_STATUS_LABEL[item.status]}</Badge></TableCell>
                <TableCell>{ratePercent(item.commission_rate_bps)}{item.commission_rate_bps == null ? <span className='text-xs text-muted-foreground'>（默认）</span> : null}</TableCell>
                <TableCell className='text-right whitespace-nowrap'>
                  <span className={item.summary.available_cents < 0 ? 'text-destructive' : ''}>{yuan(item.summary.available_cents)}</span>
                  <span className='text-muted-foreground'> / {yuan(item.summary.pending_cents)} / {yuan(item.summary.withdrawn_cents)}</span>
                </TableCell>
                <TableCell className='text-right'>{item.summary.invitee_count} / {item.summary.paid_order_count}</TableCell>
                <TableCell className='text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    {item.status === 'pending_review' ? <>
                      <Button size='sm' onClick={() => approve(item)}>通过</Button>
                      <Button size='sm' variant='outline' onClick={() => reject(item)}>驳回</Button>
                    </> : null}
                    {promoterStatusActions(item.status).map((action) => (
                      <Button key={action.target} size='sm' variant='outline' onClick={() => changeStatus(item, action.target, action.label, action.destructive)}>{action.label}</Button>
                    ))}
                    {item.status === 'active' || item.status === 'suspended' || item.status === 'pending_review'
                      ? <Button size='sm' variant='outline' onClick={() => changeRate(item)}>改比例</Button>
                      : null}
                    {item.status !== 'pending_review' && item.status !== 'rejected'
                      ? <Button size='sm' variant='ghost' onClick={() => setSelected(selected?.id === item.id ? null : item)}>佣金明细</Button>
                      : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-end gap-2 text-sm text-muted-foreground'>
        <span>共 {data.total} 人 · 第 {page}/{pages} 页</span>
        <Button size='sm' variant='outline' disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Button size='sm' variant='outline' disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>

      {selected ? <PromoterCommissionsPanel promoter={selected} onAction={onAction} onChanged={() => void load()} onClose={() => setSelected(null)} /> : null}
    </section>
  )
}
