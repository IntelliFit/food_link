import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { brand } from '@/content/brand'
import { mainNav } from '@/content/navigation'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const navLinkClass =
  'flex min-h-11 items-center rounded-xl px-4 py-3 text-base text-foreground transition-colors active:bg-muted hover:bg-muted'

/** 移动端折叠导航（底部抽屉样式，更大触控区域） */
export function MobileNavMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-10 shrink-0', className)}
        aria-label="打开导航菜单"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className={cn(
            'gap-0 overflow-hidden p-0 sm:max-w-xs',
            'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[min(85dvh,640px)] max-sm:max-w-none',
            'max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl',
            'max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
          )}
        >
          <DialogHeader className="border-b border-border px-4 py-4 text-left">
            <DialogTitle>{brand.fullName}</DialogTitle>
          </DialogHeader>

          <nav className="flex flex-col gap-1 px-3 py-3" aria-label="移动端导航">
            {mainNav.map((item) =>
              item.isAnchor ? (
                <a
                  key={item.to}
                  href={item.to}
                  className={navLinkClass}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.to}
                  to={item.to}
                  className={navLinkClass}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>

          <div className="border-t border-border px-4 py-4">
            <ExperienceButton className="w-full justify-center" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
