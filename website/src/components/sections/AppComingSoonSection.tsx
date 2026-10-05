import { ArrowUpRight } from 'lucide-react'
import { appDownload } from '@/content/app-download'
import { useReleaseChannel } from '@/hooks/useReleaseChannel'

export function AppComingSoonSection() {
  const Icon = appDownload.icon
  const { manifest } = useReleaseChannel(appDownload.manifestUrl)
  const release = manifest?.artifacts?.apk?.url ? manifest : null
  const href = release?.artifacts?.apk?.url ?? appDownload.href
  const version = release?.version ?? appDownload.version

  return (
    <section id="app-soon" className="scroll-mt-header border-t border-border bg-muted/50 py-12 md:py-24">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 md:grid-cols-[0.9fr_1.1fr] md:items-start md:px-8">
        <div className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Icon className="size-4" aria-hidden />
            {appDownload.eyebrow}
          </p>
          <h2 className="whitespace-pre-line text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {appDownload.title}
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            {appDownload.description}
          </p>
          <p className="text-sm text-muted-foreground">当前版本 v{version}</p>
        </div>

        <div className="grid gap-3">
          <a
            href={href}
            className="group flex min-h-36 flex-col justify-between rounded-lg border border-primary/30 bg-primary p-4 text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-background/90 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <ArrowUpRight
                className="size-4 text-primary-foreground/80 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </span>
            <span className="space-y-1.5">
              <span className="block text-base font-semibold">{appDownload.label}</span>
              <span className="block text-sm text-primary-foreground/80">{appDownload.downloadDescription}</span>
              <span className="block text-xs text-primary-foreground/70">v{version}</span>
            </span>
          </a>
          <p className="text-sm leading-relaxed text-muted-foreground">{appDownload.installationNote}</p>
        </div>
      </div>
    </section>
  )
}
