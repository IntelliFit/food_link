import { Activity, Flame, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { productIntro } from '@/content/product-intro'
import { cn } from '@/lib/utils'

const iconMap: Record<(typeof productIntro.featureHighlights)[number]['icon'], LucideIcon> = {
  flame: Flame,
  activity: Activity,
  users: Users,
}

const iconColorMap: Record<(typeof productIntro.featureHighlights)[number]['icon'], string> = {
  flame: 'text-macro-fat',
  activity: 'text-primary',
  users: 'text-primary',
}

/** Hero 左栏底部三枚功能亮点卡 */
export function HeroFeatureHighlights() {
  return (
    <div
      className={cn(
        'flex w-full gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory',
        '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:pb-0',
      )}
    >
      {productIntro.featureHighlights.map((item) => {
        const Icon = iconMap[item.icon]
        return (
          <div
            key={item.title}
            className={cn(
              'flex min-w-[140px] shrink-0 snap-start flex-col gap-1 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm',
              'md:min-w-0',
            )}
          >
            <Icon className={cn('size-4', iconColorMap[item.icon])} aria-hidden />
            <p className="text-sm font-medium leading-tight text-foreground">{item.title}</p>
            <p className="text-xs leading-snug text-muted-foreground">{item.subtitle}</p>
          </div>
        )
      })}
    </div>
  )
}
