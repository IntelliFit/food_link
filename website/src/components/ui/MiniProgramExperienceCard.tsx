import { useState } from 'react'
import { brand } from '@/content/brand'
import { cn } from '@/lib/utils'

type MiniProgramExperienceCardProps = {
  className?: string
}

export function MiniProgramExperienceCard({ className }: MiniProgramExperienceCardProps) {
  const [qrFailed, setQrFailed] = useState(false)

  return (
    <div
      className={cn(
        'flex w-full max-w-[320px] flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6',
        className,
      )}
    >
      <div className="text-center">
        <p className="text-base font-semibold text-foreground">{brand.fullName}</p>
        <p className="text-sm text-muted-foreground">{brand.slogan}</p>
      </div>

      <div className="flex size-40 items-center justify-center rounded-lg border border-border bg-background p-2">
        {!qrFailed ? (
          <img
            src={brand.assets.qrcode}
            alt="小程序二维码"
            className="size-full object-contain"
            onError={() => setQrFailed(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-2 text-center">
            <div className="size-8 rounded-lg border border-dashed border-border" />
            <p className="text-xs text-muted-foreground">{brand.wechatSearchHint}</p>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{brand.scanHint}</p>
    </div>
  )
}
