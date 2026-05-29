import { productIntro } from '@/content/product-intro'
import { AppDownloadSoonButton } from '@/components/ui/AppDownloadSoonButton'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { HeroPreviewPlaceholder } from '@/components/ui/HeroPreviewPlaceholder'

export function ProductIntroSection() {
  return (
    <section id="hero" className="bg-gradient-page scroll-mt-20 pt-14 pb-16 md:pt-20 md:pb-24">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 md:gap-12 md:px-8 lg:gap-16">
        <div className="flex flex-col gap-6 md:gap-8">
          <h1 className="whitespace-pre-line text-4xl font-semibold leading-[1.08] tracking-tight text-foreground md:text-5xl lg:text-6xl">
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

        <div className="w-full">
          <HeroPreviewPlaceholder />
        </div>
      </div>
    </section>
  )
}
