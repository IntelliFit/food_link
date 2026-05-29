import { cn } from '@/lib/utils'

type WechatIconProps = {
  className?: string
}

/** WeChat mark for mini-program CTA */
export function WechatIcon({ className }: WechatIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('size-4', className)}
      fill="currentColor"
    >
      <path d="M8.5 4C4.91 4 2 6.46 2 9.5c0 1.62.86 3.08 2.22 4.07L3.5 16.5l3.04-1.52c.78.22 1.61.34 2.46.34.28 0 .55-.02.82-.05-.17-.55-.26-1.13-.26-1.73 0-3.31 3.13-6 7-6 .47 0 .93.04 1.37.12C16.64 5.58 12.86 4 8.5 4zm-2.5 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
      <path d="M22 13.5c0-2.49-2.46-4.5-5.5-4.5S11 11.01 11 13.5s2.46 4.5 5.5 4.5c.85 0 1.68-.12 2.46-.34l3.04 1.52-.72-3.43C21.14 16.58 22 15.12 22 13.5zm-7 1a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  )
}
