import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ActionValues = { note: string; rate: string; confirmed: boolean }

/** 一次需要运营填写说明的操作：审核、驳回、标记打款、扣回佣金等。 */
export type ActionSpec = {
  title: string
  description?: ReactNode
  confirmLabel: string
  destructive?: boolean
  noteLabel?: string
  notePlaceholder?: string
  noteRequired?: boolean
  rateLabel?: string
  confirmCheckLabel?: string
  initialRate?: string
  run: (values: ActionValues) => Promise<void>
}

type ActionDialogProps = {
  spec: ActionSpec | null
  onClose: () => void
}

export function ActionDialog({ spec, onClose }: ActionDialogProps) {
  const [values, setValues] = useState<ActionValues>({ note: '', rate: '', confirmed: false })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (spec) setValues({ note: '', rate: spec.initialRate ?? '', confirmed: false })
  }, [spec])

  const blocked = !spec
    || (spec.noteRequired && values.note.trim() === '')
    || (spec.confirmCheckLabel !== undefined && !values.confirmed)

  async function submit() {
    if (!spec || blocked || running) return
    setRunning(true)
    try {
      await spec.run(values)
      onClose()
    } catch {
      // run 自己提示错误，弹窗保留，方便修改后重试
    } finally {
      setRunning(false)
    }
  }

  return (
    <DialogPrimitive.Root open={spec !== null} onOpenChange={(open) => { if (!open && !running) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]' />
        <DialogPrimitive.Content className='fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-5 text-foreground shadow-xl outline-none'>
          <div className='space-y-1 pr-6'>
            <DialogPrimitive.Title className='text-base font-semibold leading-6'>{spec?.title}</DialogPrimitive.Title>
            {spec?.description ? (
              <DialogPrimitive.Description asChild>
                <div className='text-sm leading-6 text-muted-foreground'>{spec.description}</div>
              </DialogPrimitive.Description>
            ) : null}
          </div>

          {spec?.rateLabel ? (
            <div className='space-y-2'>
              <Label htmlFor='action-rate'>{spec.rateLabel}</Label>
              <Input id='action-rate' placeholder='留空使用默认比例，例如 20 或 12.5' value={values.rate} onChange={(e) => setValues({ ...values, rate: e.target.value })} />
            </div>
          ) : null}

          {spec?.noteLabel ? (
            <div className='space-y-2'>
              <Label htmlFor='action-note'>{spec.noteLabel}{spec.noteRequired ? '' : '（选填）'}</Label>
              <Textarea id='action-note' maxLength={200} placeholder={spec.notePlaceholder} value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
            </div>
          ) : null}

          {spec?.confirmCheckLabel ? (
            <label className='flex items-start gap-2 text-sm'>
              <Checkbox className='mt-0.5' checked={values.confirmed} onChange={(e) => setValues({ ...values, confirmed: e.target.checked })} />
              <span>{spec.confirmCheckLabel}</span>
            </label>
          ) : null}

          <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
            <Button variant='outline' onClick={onClose} disabled={running}>取消</Button>
            <Button variant={spec?.destructive ? 'destructive' : 'default'} onClick={() => void submit()} disabled={blocked || running}>
              {running ? <Loader2 className='size-4 animate-spin' /> : null}
              {spec?.confirmLabel}
            </Button>
          </div>

          <DialogPrimitive.Close asChild>
            <button type='button' className='absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground' disabled={running} aria-label='关闭'>
              <X className='size-4' />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
