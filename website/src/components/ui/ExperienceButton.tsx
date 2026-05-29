import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { MiniProgramExperienceCard } from '@/components/ui/MiniProgramExperienceCard'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { WechatIcon } from '@/components/ui/WechatIcon'
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

type ExperienceButtonProps = {
  className?: string
  /** simple：导航栏纯文字；wechat：带副标题；hero：Hero 区单行 CTA */
  variant?: 'simple' | 'wechat' | 'hero'
}

const simpleTriggerClass =
  'inline-flex h-9 shrink-0 items-center rounded-[12px] bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:h-6 md:px-4'

const wechatTriggerClass =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:gap-0 sm:overflow-hidden sm:px-0'

const heroTriggerClass =
  'inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/** 「立即体验」CTA：移动端用 Dialog 展示二维码，桌面端用 Popover */
export function ExperienceButton({ className, variant = 'wechat' }: ExperienceButtonProps) {
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const [open, setOpen] = useState(false)

  const triggerContent =
    variant === 'simple' ? (
      '立即体验'
    ) : variant === 'hero' ? (
      <>
        <WechatIcon className="size-4 shrink-0 text-primary-foreground" />
        <span className="leading-none">微信扫码体验</span>
        <ArrowRight className="size-4 shrink-0 text-primary-foreground/90" aria-hidden />
      </>
    ) : (
      <>
        <WechatIcon className="size-4 shrink-0 text-primary-foreground sm:ml-2.5" />
        <span className="leading-none sm:hidden">扫一扫立即体验</span>
        <span className="hidden h-full flex-col justify-center pr-3.5 text-left sm:flex">
          <span className="text-sm font-semibold leading-tight">扫一扫立即体验</span>
          <span className="mt-0.5 text-xs leading-tight text-primary-foreground/75">微信小程序</span>
        </span>
      </>
    )

  const triggerClassName = cn(
    variant === 'simple'
      ? simpleTriggerClass
      : variant === 'hero'
        ? heroTriggerClass
        : wechatTriggerClass,
    className,
  )

  if (isMobile) {
    return (
      <>
        <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
          {triggerContent}
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            showCloseButton
            className="max-w-[calc(100%-1.5rem)] gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-sm"
          >
            <MiniProgramExperienceCard className="mx-auto" />
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <Popover>
      <PopoverTrigger className={triggerClassName} render={<button type="button" />}>
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent className="w-auto border-border bg-transparent p-0 shadow-none ring-0">
        <MiniProgramExperienceCard />
      </PopoverContent>
    </Popover>
  )
}
