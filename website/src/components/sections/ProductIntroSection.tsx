import { productIntro } from '@/content/product-intro'
import { AppDownloadSoonButton } from '@/components/ui/AppDownloadSoonButton'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { HeroFlowVisual } from '@/components/hero/HeroFlowVisual'

export function ProductIntroSection() {
  return (
    <section
      id="hero"
      className="bg-gradient-page scroll-mt-header pt-below-header pb-12 md:pb-24"
    >
      <div className="mx-auto w-full max-w-7xl px-4 md:px-8 lg:px-10">
        <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-between md:gap-10 lg:gap-12">
          <div className="flex w-full flex-col items-center gap-5 text-center md:max-w-[520px] md:items-start md:gap-8 md:text-left lg:max-w-[540px]">
            <h1 className="whitespace-pre-line text-[1.75rem] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-4xl md:text-5xl lg:text-[3.25rem]">
              {productIntro.title}
            </h1>
            <p className="max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-base md:text-lg">
              {productIntro.description}
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2.5 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center md:justify-start">
              <ExperienceButton className="w-full justify-center sm:w-auto" />
              <AppDownloadSoonButton className="w-full justify-center sm:w-auto" />
            </div>
          </div>

          <div className="flex w-full shrink-0 justify-center md:w-auto">
            <HeroFlowVisual />
          </div>
        </div>
      </div>
    </section>
  )
}
