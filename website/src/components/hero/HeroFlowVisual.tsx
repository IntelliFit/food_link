import { heroFlow } from '@/content/product-intro'
import { cn } from '@/lib/utils'
import { HeroPhoneMockup } from '@/components/hero/HeroPhoneMockup'

type HeroFlowVisualProps = {
  className?: string
}

/** Hero 右侧：stage2 手机 mockup（移动端取消 3D 倾角，避免溢出与视觉干扰） */
export function HeroFlowVisual({ className }: HeroFlowVisualProps) {
  return (
    <div
      className={cn(
        'relative mx-auto flex w-fit max-w-full items-center justify-center',
        'md:[perspective:1400px]',
        className,
      )}
      aria-label={heroFlow.ariaLabel}
    >
      <div className="hero-phone-tilt w-full">
        <HeroPhoneMockup />
      </div>
    </div>
  )
}
