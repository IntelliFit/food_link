import { MiniProgramExperienceCard } from '@/components/ui/MiniProgramExperienceCard'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { WechatIcon } from '@/components/ui/WechatIcon'
import { cn } from '@/lib/utils'

type ExperienceButtonProps = {
  className?: string
  /** simple：导航栏纯文字；wechat：首页带微信图标与说明 */
  variant?: 'simple' | 'wechat'
}

/** 「立即体验」CTA */
export function ExperienceButton({ className, variant = 'wechat' }: ExperienceButtonProps) {
  if (variant === 'simple') {
    return (
      <Popover>
        <PopoverTrigger
          className={cn(
            'inline-flex h-6 shrink-0 items-center rounded-[12px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            className,
          )}
          render={<button type="button" />}
        >
          立即体验
        </PopoverTrigger>
        <PopoverContent className="w-auto border-border bg-transparent p-0 shadow-none ring-0">
          <MiniProgramExperienceCard />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-10 shrink-0 items-center overflow-hidden rounded-[12px] bg-primary shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        )}
        render={<button type="button" />}
      >
        <span className="flex h-full items-center justify-center pl-2.5 pr-1 text-primary-foreground">
          <WechatIcon className="size-4" />
        </span>
        <span className="flex h-full flex-col justify-center pr-3.5 text-left text-primary-foreground">
          <span className="text-sm font-semibold leading-tight">扫一扫立即体验</span>
          <span className="mt-0.5 text-xs leading-tight text-primary-foreground/75">
            微信小程序
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto border-border bg-transparent p-0 shadow-none ring-0">
        <MiniProgramExperienceCard />
      </PopoverContent>
    </Popover>
  )
}
