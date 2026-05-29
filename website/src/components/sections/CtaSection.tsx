import { QrCode } from 'lucide-react'
import { cta } from '@/content/features'
import { MiniProgramExperienceCard } from '@/components/ui/MiniProgramExperienceCard'

export function CtaSection() {
  return (
    <section id="cta" className="scroll-mt-20 bg-background py-16 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 md:gap-12 md:px-8">
        <div className="flex flex-col gap-4">
          <p className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary">
            <QrCode className="size-4" aria-hidden />
            立即体验
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            {cta.title}
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            {cta.description}
          </p>
        </div>

        <div className="flex justify-center md:justify-end">
          <MiniProgramExperienceCard />
        </div>
      </div>
    </section>
  )
}
