import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import type { ActionSpec } from '@/components/action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminRequest, copyText } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { COMMISSION_STATUS_LABEL, ratePercent, yuan } from '@/lib/promoter-format'
import type { AdminCommission, AdminPromoter, Page } from '@/types/promoter'

const PAGE_SIZE = 20

type Props = {
  promoter: AdminPromoter
  onAction: (spec: ActionSpec) => void
  onChanged: () => void
  onClose: () => void
}

/** 一位推广员的佣金明细；微信商户平台上手工退款的订单在这里扣回佣金。 */
export function PromoterCommissionsPanel({ promoter, onAction, onChanged, onClose }: Props) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<AdminCommission>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoter.id, page])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      setData(await adminRequest<Page<AdminCommission>>(`/api/admin/promoters/${encodeURIComponent(promoter.id)}/commissions?${params}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取佣金明细失败')
    } finally {
      setLoading(false)
    }
  }

  function reverse(item: AdminCommission) {
    const settled = item.status === 'available'
    onAction({
      title: `扣回佣金 ${yuan(item.commission_cents)}？`,
      description: settled
        ? '这笔佣金已结算，扣回后推广员余额会减少，已提现的可能变成负数，之后的佣金先抵扣。不能撤销。'
        : '这笔佣金还在冻结期，扣回后不会进入余额。不能撤销。',
      confirmLabel: '扣回',
      destructive: true,
      noteLabel: '原因，例如商户平台退款单号',
      noteRequired: true,
      run: async ({ note }) => {
        try {
          await adminRequest(`/api/admin/promoter-commissions/${encodeURIComponent(item.id)}/reverse`, { method: 'POST', body: JSON.stringify({ reason: note }) })
          toast.success('佣金已扣回')
          void load()
          onChanged()
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '扣回失败')
          throw error
        }
      },
    })
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between gap-3'>
        <CardTitle className='text-base'>
          {promoter.nickname || '推广员'} · {promoter.promo_code} 的佣金明细
          {loading ? <Loader2 className='ml-2 inline size-4 animate-spin text-muted-foreground' /> : null}
        </CardTitle>
        <Button size='sm' variant='ghost' onClick={onClose} aria-label='关闭'><X className='size-4' /></Button>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-xs text-muted-foreground'>在微信支付商户平台手工退款不会写回订单表。按订单号核对后，在这里扣回对应佣金。</p>
        <div className='rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>支付时间</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>被推广用户</TableHead>
                <TableHead className='text-right'>实付 × 比例</TableHead>
                <TableHead className='text-right'>佣金</TableHead>
                <TableHead>订单 / 佣金状态</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow><TableCell colSpan={7} className='py-8 text-center text-muted-foreground'>{loading ? '' : '还没有佣金'}</TableCell></TableRow>
              ) : data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className='whitespace-nowrap'>{formatTime(item.paid_at, true)}</TableCell>
                  <TableCell>
                    <button type='button' className='font-mono text-xs hover:underline' title='复制订单号' onClick={() => void copyText(item.order_no).then(() => toast.success('已复制订单号'))}>
                      {item.order_no || '-'}
                    </button>
                    <div className='text-xs text-muted-foreground'>{item.pay_channel} · {item.plan_code}</div>
                  </TableCell>
                  <TableCell>{item.invitee_nickname || '未命名用户'}</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{yuan(item.order_amount_cents)} × {ratePercent(item.rate_bps)}</TableCell>
                  <TableCell className='text-right font-medium'>{yuan(item.commission_cents)}</TableCell>
                  <TableCell>
                    <div className='flex items-center gap-1'>
                      <Badge variant='outline'>{item.order_status || '订单缺失'}</Badge>
                      <Badge variant={item.status === 'cancelled' || item.status === 'reversed' ? 'destructive' : 'outline'}>{COMMISSION_STATUS_LABEL[item.status]}</Badge>
                    </div>
                    {item.status === 'pending' ? <div className='mt-1 text-xs text-muted-foreground'>{formatTime(item.settle_at, true)} 结算</div> : null}
                    {item.reverse_reason ? <div className='mt-1 max-w-[220px] truncate text-xs text-muted-foreground' title={item.reverse_reason}>{item.reverse_reason}</div> : null}
                  </TableCell>
                  <TableCell className='text-right'>
                    {item.status === 'pending' || item.status === 'available'
                      ? <Button size='sm' variant='outline' onClick={() => reverse(item)}>扣回</Button>
                      : null}
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
      </CardContent>
    </Card>
  )
}
