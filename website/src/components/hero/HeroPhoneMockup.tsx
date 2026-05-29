import { heroFlow } from '@/content/product-intro'
import { cn } from '@/lib/utils'
import { heroPhoneWidth } from '@/components/hero/hero-visual-config'

type HeroPhoneMockupProps = {
  className?: string
}

/** Hero 中心手机 mockup（stage2），倾角由父级统一控制 */
export function HeroPhoneMockup({ className }: HeroPhoneMockupProps) {
  return (
    <div className={cn('relative z-10', heroPhoneWidth, className)}>
      <div
        className={cn(
          'relative aspect-[9/19.5] w-full',
          'rounded-[48px] border-[12px] border-[#1a1a1c] bg-[#1a1a1c]',
          'shadow-[0_36px_72px_-20px_rgb(0_0_0_/_0.38)] ring-1 ring-black/12',
        )}
      >
        <div
          className="absolute left-1/2 top-[12px] z-10 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-black"
          aria-hidden
        />
        <div className="size-full overflow-hidden rounded-[36px]">
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
