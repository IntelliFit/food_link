import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { mainNav } from '@/content/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** 移动端折叠导航 */
export function MobileNavMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn('shrink-0', className)}
        aria-label="打开导航菜单"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-6 sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>导航</DialogTitle>
          </DialogHeader>
          <nav className="flex flex-col gap-1" aria-label="移动端导航">
            {mainNav.map((item) =>
              item.isAnchor ? (
                <a
                  key={item.to}
                  href={item.to}
                  className="rounded-lg px-3 py-3 text-base text-foreground transition-colors hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-lg px-3 py-3 text-base text-foreground transition-colors hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </>
  )
}
