import { cn } from '@/lib/utils'

type PhoneMockup2DProps = {
  src: string
  alt: string
  className?: string
}

/**
 * 纯平面 CSS iPhone 风格 mockup — 无透视、无倾斜
 */
export function PhoneMockup2D({ src, alt, className }: PhoneMockup2DProps) {
  return (
    <div className={cn('relative mx-auto w-full max-w-[300px]', className)} aria-label={alt}>
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[44px] border-[11px] border-[#1c1c1e] bg-[#1c1c1e] shadow-md ring-1 ring-black/10">
        {/* Dynamic Island */}
        <div
          className="absolute left-1/2 top-[11px] z-10 h-[21px] w-[78px] -translate-x-1/2 rounded-full bg-[#1c1c1e]"
          aria-hidden
        />
        <img
          src={src}
          alt={alt}
          className="size-full object-cover object-top"
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
  )
}
