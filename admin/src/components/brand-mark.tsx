import { Leaf } from 'lucide-react'
import { cn } from '@/lib/utils'

type BrandMarkProps = {
  className?: string
}

/** 品牌标识 */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5 text-sm font-semibold tracking-wide text-primary', className)}>
      <span className="relative flex size-3">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/30 opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-primary shadow-[0_0_0_6px_oklch(0.68_0.16_162/12%)]" />
      </span>
      <Leaf className="size-4" aria-hidden />
      <span>Food Link Admin</span>
    </div>
  )
}
