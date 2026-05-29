import { LayoutTemplate } from 'lucide-react'
import { productIntro } from '@/content/product-intro'
import { cn } from '@/lib/utils'

type HeroPreviewPlaceholderProps = {
  className?: string
}

/** Cal AI–style hero visual: wide, tall product preview area */
export function HeroPreviewPlaceholder({ className }: HeroPreviewPlaceholderProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-3xl border border-border bg-muted/60 md:min-h-[480px] lg:min-h-[560px]',
        className,
      )}
      aria-label={productIntro.previewLabel}
    >
      {/* Decorative phone silhouettes — Cal AI dual-phone layout hint */}
      <div className="absolute inset-0 flex items-end justify-center gap-4 pb-8 md:gap-8 md:pb-12">
        <div className="aspect-[9/19.5] h-[72%] max-h-[420px] rounded-[28px] border-2 border-dashed border-border/80 bg-background/40" />
        <div className="aspect-[9/19.5] h-[82%] max-h-[460px] -translate-y-4 rounded-[28px] border-2 border-dashed border-primary/30 bg-background/60 shadow-sm md:-translate-y-6" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-background/90 shadow-sm backdrop-blur-sm">
          <LayoutTemplate className="size-8 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium text-foreground">{productIntro.previewLabel}</p>
          <p className="text-sm text-muted-foreground">{productIntro.previewHint}</p>
        </div>
      </div>
    </div>
  )
}
