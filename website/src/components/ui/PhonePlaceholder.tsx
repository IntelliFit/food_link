import { cn } from '@/lib/utils'

type PhonePlaceholderProps = {
  label: string
  className?: string
}

export function PhonePlaceholder({ label, className }: PhonePlaceholderProps) {
  return (
    <div
      className={cn(
        'aspect-[9/19.5] w-full max-w-[280px] overflow-hidden rounded-[32px] border border-border bg-muted shadow-sm',
        className,
      )}
      aria-label={label}
    >
      <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
        <div className="size-2 rounded-full bg-primary/40" />
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground/80">截图占位</p>
      </div>
    </div>
  )
}
