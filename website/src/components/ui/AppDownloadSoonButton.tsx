import { Download } from 'lucide-react'
import { appDownload } from '@/content/app-download'
import { useReleaseChannel } from '@/hooks/useReleaseChannel'
import { cn } from '@/lib/utils'

type AppDownloadSoonButtonProps = {
  className?: string
}

/** 原生 App 下载 CTA。组件名保留以减少历史引用改动。 */
export function AppDownloadSoonButton({ className }: AppDownloadSoonButtonProps) {
  const primaryDownload = appDownload.options.find((option) => option.id === 'stable-apk') ?? appDownload.options[0]
  const { manifest } = useReleaseChannel(appDownload.channels.stable)
  const href = manifest?.artifacts?.apk?.url ?? primaryDownload.href

  return (
    <a
      href={href}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-border bg-background px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary',
        className,
      )}
    >
      <Download className="size-4 shrink-0" aria-hidden />
      下载 Android App
    </a>
  )
}
