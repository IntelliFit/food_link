import { productIntro } from '@/content/product-intro'
import { AppDownloadSoonButton } from '@/components/ui/AppDownloadSoonButton'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { HeroFlowVisual } from '@/components/hero/HeroFlowVisual'

export function ProductIntroSection() {
  return (
    <section id="hero" className="bg-gradient-page scroll-mt-20 pt-14 pb-16 md:pt-20 md:pb-24">
      {/* 文案 + 手机作为整体，页面内居中 */}
      <div className="mx-auto w-full max-w-7xl px-4 md:px-8 lg:px-10">
        <div className="flex flex-col items-center gap-10 md:flex-row md:items-center md:justify-between md:gap-12 lg:gap-16">
          <div className="flex w-full flex-col gap-6 md:max-w-[520px] md:gap-8 lg:max-w-[540px]">
            <h1 className="whitespace-pre-line text-4xl font-semibold leading-[1.08] tracking-tight text-foreground md:text-5xl lg:text-[3.25rem]">
              {productIntro.title}
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground md:text-lg">
              {productIntro.description}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <ExperienceButton />
              <AppDownloadSoonButton />
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
