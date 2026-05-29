import { heroFlow } from '@/content/product-intro'
import { cn } from '@/lib/utils'
import { HeroPhoneMockup } from '@/components/hero/HeroPhoneMockup'
import { HERO_PLANE_TILT } from '@/components/hero/hero-plane-tilt'

type HeroFlowVisualProps = {
  className?: string
}

/** Hero 右侧：stage2 手机 mockup */
export function HeroFlowVisual({ className }: HeroFlowVisualProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center',
        '[perspective:1400px]',
        className,
      )}
      aria-label={heroFlow.ariaLabel}
    >
      <div style={{ transform: HERO_PLANE_TILT }}>
        <HeroPhoneMockup />
      </div>
    </div>
  )
}
