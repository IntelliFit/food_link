import { MessageCircle } from 'lucide-react'
import { userGroup } from '@/content/user-group'
import { UserGroupQrCard } from '@/components/ui/UserGroupQrCard'

/** 「从第一餐开始」之后：加入用户群说明与二维码 */
export function UserGroupSection() {
  return (
    <section id="user-group" className="scroll-mt-header border-t border-border bg-muted/40 py-12 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 md:gap-12 md:px-8">
        <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
          <p className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary">
            <MessageCircle className="size-4" aria-hidden />
            {userGroup.eyebrow}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {userGroup.title}
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
            {userGroup.description}
          </p>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground/90">
            {userGroup.fallbackHint}
          </p>
        </div>

        <div className="flex w-full justify-center md:justify-end">
          <UserGroupQrCard className="w-full max-w-[min(100%,320px)]" />
        </div>
      </div>
    </section>
  )
}
