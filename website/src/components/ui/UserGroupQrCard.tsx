import { useState } from 'react'
import { userGroup } from '@/content/user-group'
import { cn } from '@/lib/utils'

type UserGroupQrCardProps = {
  className?: string
}

/** 用户群二维码卡片（对齐小程序「加入用户群」页） */
export function UserGroupQrCard({ className }: UserGroupQrCardProps) {
  const [qrFailed, setQrFailed] = useState(false)

  return (
    <div
      className={cn(
        'flex w-full max-w-[320px] flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6',
        className,
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0 text-left">
          <p className="text-base font-semibold text-foreground">{userGroup.groupName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{userGroup.groupSubtitle}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          当前推荐
        </span>
      </div>

      <div className="flex size-44 items-center justify-center rounded-lg border border-border bg-background p-2 sm:size-40">
        {!qrFailed ? (
          <img
            src={userGroup.qrImage}
            alt={userGroup.qrAlt}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
            onError={() => setQrFailed(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-2 text-center">
            <div className="size-8 rounded-lg border border-dashed border-border" />
            <p className="text-xs text-muted-foreground">{userGroup.fallbackHint}</p>
          </div>
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">{userGroup.scanHint}</p>
    </div>
  )
}
