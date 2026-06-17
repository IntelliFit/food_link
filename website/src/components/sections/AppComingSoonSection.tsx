import { ArrowUpRight } from 'lucide-react'
import { appDownload } from '@/content/app-download'
import { useReleaseChannel } from '@/hooks/useReleaseChannel'
import type { AppDownloadOption } from '@/content/app-download'

export function AppComingSoonSection() {
  const ChecksumIcon = appDownload.checksumIcon
  const ManifestIcon = appDownload.manifestIcon
  const stable = useReleaseChannel(appDownload.channels.stable)
  const beta = useReleaseChannel(appDownload.channels.beta)
  const manifests = {
    stable: stable.manifest,
    beta: beta.manifest,
  }
  const stableApk = stable.manifest?.artifacts?.apk
  const resolvedVersion = stable.manifest?.version ?? appDownload.version
  const resolvedBuild = stable.manifest?.buildNumber ?? appDownload.build
  const releaseManifestHref = stable.manifest?.releaseManifestUrl ?? stable.manifest?.url

  const options = appDownload.options
    .map((option): AppDownloadOption | null => {
      const manifest = manifests[option.channel]
      const artifact = manifest?.artifacts?.[option.artifact]

      if (option.artifact === 'aab' && !artifact) {
        return null
      }

      const version = manifest?.version ?? appDownload.version
      const build = manifest?.buildNumber ?? appDownload.build

      return {
        ...option,
        href: artifact?.url ?? option.href,
        meta:
          option.artifact === 'apk'
            ? `${option.channel} · v${version} (${build})`
            : `${option.channel} · app bundle`,
      }
    })
    .filter((option): option is AppDownloadOption => Boolean(option))

  return (
    <section id="app-soon" className="scroll-mt-header border-t border-border bg-muted/50 py-12 md:py-24">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 md:grid-cols-[0.9fr_1.1fr] md:items-start md:px-8">
        <div className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <ChecksumIcon className="size-4" aria-hidden />
            {appDownload.eyebrow}
          </p>
          <h2 className="whitespace-pre-line text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {appDownload.title}
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            {appDownload.description}
          </p>
          <div className="flex flex-wrap gap-2 pt-1 text-sm text-muted-foreground">
            <span className="rounded-full border border-border bg-background px-3 py-1">
              v{resolvedVersion}
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1">
              build {resolvedBuild}
            </span>
            {stableApk?.sha256 ? (
              <span className="rounded-full border border-border bg-background px-3 py-1">
                SHA256 {stableApk.sha256.slice(0, 8)}
              </span>
            ) : null}
            <span className="rounded-full border border-border bg-background px-3 py-1">
              {appDownload.checksumLabel}
            </span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const Icon = option.icon
            return (
              <a
                key={option.id}
                href={option.href}
                className={
                  option.primary
                    ? 'group flex min-h-36 flex-col justify-between rounded-lg border border-primary/30 bg-primary p-3 text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5'
                    : 'group flex min-h-36 flex-col justify-between rounded-lg border border-border bg-background p-3 text-foreground shadow-sm transition-transform hover:-translate-y-0.5 hover:border-primary/40'
                }
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-background/90 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <ArrowUpRight
                    className={
                      option.primary
                        ? 'size-4 text-primary-foreground/80 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
                        : 'size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
                    }
                    aria-hidden
                  />
                </span>
                <span className="space-y-1.5">
                  <span className="block text-base font-semibold">{option.label}</span>
                  <span className={option.primary ? 'block text-sm text-primary-foreground/80' : 'block text-sm text-muted-foreground'}>
                    {option.description}
                  </span>
                  <span className={option.primary ? 'block text-xs text-primary-foreground/70' : 'block text-xs text-muted-foreground'}>
                    {option.meta}
                  </span>
                </span>
              </a>
            )
          })}
          <div className="sm:col-span-2 rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <ManifestIcon className="size-4 text-primary" aria-hidden />
              版本清单
            </div>
            <div className="flex flex-wrap gap-2">
              {appDownload.manifests.map((manifest) => (
                <a
                  key={manifest.id}
                  href={manifest.id === 'release' && releaseManifestHref ? releaseManifestHref : manifest.href}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {manifest.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
