import { Link } from 'react-router-dom'
import { brand } from '@/content/brand'
import { ContactDialog } from '@/components/ui/ContactDialog'

export function SiteFooter() {
  const { footer } = brand

  return (
    <footer className="border-t border-border bg-muted/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-base font-semibold text-foreground">{brand.fullName}</p>
            <p className="text-sm text-muted-foreground">{brand.companyName}</p>
            <a
              href={brand.icpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {brand.icpNumber}
            </a>
          </div>

          <nav className="flex flex-wrap gap-4 text-sm" aria-label="法律与联系">
            <Link
              to={footer.links.terms.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {footer.links.terms.label}
            </Link>
            <Link
              to={footer.links.privacy.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {footer.links.privacy.label}
            </Link>
            <ContactDialog />
          </nav>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-8">
          <p className="text-xs text-muted-foreground">{footer.disclaimer}</p>
          <p className="text-xs text-muted-foreground">{footer.copyright}</p>
        </div>
      </div>
    </footer>
  )
}
