import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PhonePlaceholder } from '@/components/ui/PhonePlaceholder'
import type { FeatureBlock } from '@/content/features'
import { cn } from '@/lib/utils'

type FeaturePanelProps = {
  feature: FeatureBlock
  reversed?: boolean
}

export function FeaturePanel({ feature, reversed = false }: FeaturePanelProps) {
  const Icon = feature.icon

  return (
    <div
      id={feature.id}
      className={cn(
        'mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-4 transition-opacity duration-300 md:flex-row md:items-center md:gap-16 md:px-8 lg:gap-20',
        reversed && 'md:flex-row-reverse',
      )}
    >
      <div className="flex w-full flex-1 flex-col gap-4 md:min-w-0">
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

      <div className="flex w-full shrink-0 justify-center md:w-auto">
        <PhonePlaceholder label={feature.screenshotLabel} />
      </div>
    </div>
  )
}
