import { Sparkles } from 'lucide-react'
import { productIntro } from '@/content/product-intro'
import { AppDownloadSoonButton } from '@/components/ui/AppDownloadSoonButton'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { HeroFeatureHighlights } from '@/components/hero/HeroFeatureHighlights'
import { HeroFlowVisual } from '@/components/hero/HeroFlowVisual'
import { HeroHeadline } from '@/components/hero/HeroHeadline'

export function ProductIntroSection() {
  return (
    <section
      id="hero"
      className="bg-gradient-page scroll-mt-header pb-10 pt-[calc(3.5rem+env(safe-area-inset-top,0px)+1.25rem)] md:pb-20 md:pt-[calc(4rem+env(safe-area-inset-top,0px)+1.5rem)]"
    >
      <div className="mx-auto w-full max-w-7xl px-4 md:px-8 lg:px-10">
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:justify-between md:gap-8 lg:gap-10">
          <div className="flex w-full flex-col items-center gap-4 text-center md:max-w-[520px] md:items-start md:gap-5 md:text-left lg:max-w-[540px]">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary sm:text-sm">
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {productIntro.badge}
            </span>

            <div className="flex w-full flex-col gap-1.5 sm:gap-2">
              <HeroHeadline />
              <p className="max-w-md text-[0.9375rem] leading-snug text-muted-foreground sm:text-base md:text-lg md:leading-relaxed">
                {productIntro.description}
              </p>
            </div>

            <div className="flex w-full max-w-sm flex-col gap-2 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center md:justify-start">
              <ExperienceButton variant="hero" className="w-full justify-center sm:w-auto" />
              <AppDownloadSoonButton className="w-full justify-center sm:w-auto" />
            </div>

            <HeroFeatureHighlights />
          </div>

          <div className="flex w-full shrink-0 justify-center md:w-auto">
            <HeroFlowVisual />
          </div>
        </div>
      </div>
    </section>
  )
}
