import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PhonePlaceholder } from '@/components/ui/PhonePlaceholder'
import type { FeatureBlock } from '@/content/features'
import { cn } from '@/lib/utils'

type FeatureSectionProps = {
  feature: FeatureBlock
  reversed?: boolean
}

export function FeatureSection({ feature, reversed = false }: FeatureSectionProps) {
  const Icon = feature.icon

  return (
    <section
      id={feature.id}
      className={cn(
        'scroll-mt-20 py-16 md:py-24',
        feature.emphasized ? 'bg-muted/50' : 'bg-background',
      )}
    >
      <div
        className={cn(
          'mx-auto grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 md:gap-12 md:px-8',
          reversed && 'md:[&>*:first-child]:order-2',
        )}
      >
        <div className="flex flex-col gap-4">
          <Badge variant="secondary" className="w-fit gap-2">
            <Icon className="size-4" aria-hidden />
            {feature.badge}
          </Badge>
          <h2
            className={cn(
              'whitespace-pre-line font-semibold tracking-tight text-foreground',
              feature.emphasized ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl',
            )}
          >
            {feature.title}
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            {feature.description}
          </p>
          <ul className="flex flex-col gap-2">
            {feature.highlights.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground md:text-base">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center md:justify-end">
          <PhonePlaceholder label={feature.screenshotLabel} />
        </div>
      </div>
    </section>
  )
}
