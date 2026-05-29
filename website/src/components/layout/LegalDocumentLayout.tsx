import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { brand } from '@/content/brand'
import { Button } from '@/components/ui/button'

type LegalDocumentLayoutProps = {
  title: string
  updatedAt: string
  children: React.ReactNode
}

export function LegalDocumentLayout({ title, updatedAt, children }: LegalDocumentLayoutProps) {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-4 px-4 md:px-8">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/" />}
            nativeButton={false}
            aria-label="返回首页"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <img
              src={brand.assets.loginLogo}
              alt={brand.shortName}
              className="size-6 rounded-md object-contain"
            />
            <span className="text-sm font-medium text-foreground">{brand.shortName}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
        <div className="flex flex-col gap-2 border-b border-border pb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">最后更新日期：{updatedAt}</p>
        </div>
        <div className="flex flex-col gap-8 py-8">{children}</div>
      </main>
    </div>
  )
}
