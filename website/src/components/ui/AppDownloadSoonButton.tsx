import { Download } from 'lucide-react'
import { appDownload } from '@/content/app-download'
import { useReleaseChannel } from '@/hooks/useReleaseChannel'
import { cn } from '@/lib/utils'

type AppDownloadSoonButtonProps = {
  className?: string
}

/** 原生 App 下载 CTA。组件名保留以减少历史引用改动。 */
export function AppDownloadSoonButton({ className }: AppDownloadSoonButtonProps) {
  const primaryDownload = appDownload.options.find((option) => option.channel === appDownload.primaryChannel && option.artifact === 'apk') ?? appDownload.options[0]
  const { manifest } = useReleaseChannel(appDownload.channels[primaryDownload.channel])
  const href = manifest?.artifacts?.apk?.url ?? primaryDownload.href
  const version = manifest?.version ?? appDownload.fallbackReleases[primaryDownload.channel].version
  const channelLabel = primaryDownload.channel === 'beta' ? '内测版' : '正式版'

  return (
    <a
      href={href}
      title={primaryDownload.description}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-border bg-background px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary',
        className,
      )}
    >
      <Download className="size-4 shrink-0" aria-hidden />
      下载 Android {channelLabel} v{version}
    </a>
  )
}
