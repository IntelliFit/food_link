import { Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'

type AppDownloadSoonButtonProps = {
  className?: string
}

/** 原生 App 尚未上线时的占位 CTA */
export function AppDownloadSoonButton({ className }: AppDownloadSoonButtonProps) {
  return (
    <button
      type="button"
      disabled
      aria-disabled
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-border bg-background px-3.5 text-sm font-medium text-muted-foreground',
        className,
      )}
    >
      <Smartphone className="size-4 shrink-0 opacity-70" aria-hidden />
      App 下载即将开放
    </button>
  )
}
