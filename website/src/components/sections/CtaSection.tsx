import { QrCode } from 'lucide-react'
import { cta } from '@/content/features'
import { MiniProgramExperienceCard } from '@/components/ui/MiniProgramExperienceCard'

export function CtaSection() {
  return (
    <section id="cta" className="scroll-mt-header bg-background py-12 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 md:gap-12 md:px-8">
        <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
          <p className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary">
            <QrCode className="size-4" aria-hidden />
            立即体验
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {cta.title}
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            {cta.description}
          </p>
        </div>

        <div className="flex w-full justify-center md:justify-end">
          <MiniProgramExperienceCard className="w-full max-w-[min(100%,320px)]" />
        </div>
      </div>
    </section>
  )
}
