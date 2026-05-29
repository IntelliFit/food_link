import { Mail, MessageCircle } from 'lucide-react'
import { brand } from '@/content/brand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type ContactDialogProps = {
  className?: string
}

export function ContactDialog({ className }: ContactDialogProps) {
  const { contact } = brand

  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          'cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground',
          className,
        )}
      >
        {brand.footer.links.contact.label}
      </DialogTrigger>
      <DialogContent className="gap-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact.title}</DialogTitle>
          <DialogDescription>{contact.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4 rounded-xl border border-border bg-muted/50 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">{contact.emailLabel}</p>
              <a
                href={`mailto:${contact.email}`}
                className="text-sm text-primary hover:underline"
              >
                {contact.email}
              </a>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl border border-border bg-muted/50 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
              <MessageCircle className="size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">用户群与反馈</p>
              <p className="text-sm text-muted-foreground">{contact.supportHint}</p>
            </div>
          </div>
        </div>

        <Button render={<a href={`mailto:${contact.email}`} />} nativeButton={false} className="w-full">
          发送邮件
        </Button>
      </DialogContent>
    </Dialog>
  )
}
