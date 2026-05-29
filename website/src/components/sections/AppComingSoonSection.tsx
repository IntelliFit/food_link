import { Smartphone } from 'lucide-react'
import { appComingSoon } from '@/content/features'

export function AppComingSoonSection() {
  return (
    <section id="app-soon" className="scroll-mt-20 border-t border-border bg-muted/50 py-16 md:py-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 text-center md:px-8">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Smartphone className="size-4" aria-hidden />
          {appComingSoon.eyebrow}
        </p>
        <h2 className="whitespace-pre-line text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {appComingSoon.title}
        </h2>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          {appComingSoon.description}
        </p>
      </div>
    </section>
  )
}
