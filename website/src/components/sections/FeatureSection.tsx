import type { FeatureBlock } from '@/content/features'
import { FeaturePanel } from '@/components/sections/FeaturePanel'
import { cn } from '@/lib/utils'

type FeatureSectionProps = {
  feature: FeatureBlock
  reversed?: boolean
}

/** 纵向独立区块（小屏 / 减少动效时回退布局） */
export function FeatureSection({ feature, reversed = false }: FeatureSectionProps) {
  return (
    <section
      className={cn(
        'scroll-mt-header py-12 md:py-24',
        feature.emphasized ? 'bg-muted/50' : 'bg-background',
      )}
    >
      <FeaturePanel feature={feature} reversed={reversed} />
    </section>
  )
}
