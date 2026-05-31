import { heroFlow } from '@/content/product-intro'
import { cn } from '@/lib/utils'
import { heroPhoneWidth } from '@/components/hero/hero-visual-config'

type HeroPhoneMockupProps = {
  className?: string
}

/** Hero 中心手机 mockup（stage2），倾角由父级统一控制 */
export function HeroPhoneMockup({ className }: HeroPhoneMockupProps) {
  return (
    <div className={cn('relative z-10 mx-auto', heroPhoneWidth, className)}>
      <div
        className={cn(
          'relative aspect-[9/19.5] w-full',
          'rounded-[36px] border-[8px] border-[#1a1a1c] bg-[#1a1a1c] md:rounded-[48px] md:border-[12px]',
          'shadow-[0_24px_48px_-16px_rgb(0_0_0_/_0.32)] md:shadow-[0_36px_72px_-20px_rgb(0_0_0_/_0.38)] ring-1 ring-black/12',
        )}
      >
        <div
          className="absolute left-1/2 top-[10px] z-10 h-[18px] w-[68px] -translate-x-1/2 rounded-full bg-black md:top-[12px] md:h-[22px] md:w-[84px]"
          aria-hidden
        />
        <div className="size-full overflow-hidden rounded-[28px] md:rounded-[36px]">
          <img
            src={heroFlow.screenImage}
            alt={heroFlow.screenLabel}
            className="size-full object-cover object-top"
            loading="eager"
            decoding="async"
          />
        </div>
      </div>
    </div>
  )
}
