import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { AppComingSoonSection } from '@/components/sections/AppComingSoonSection'
import { CtaSection } from '@/components/sections/CtaSection'
import { FeatureScrollCarousel } from '@/components/sections/FeatureScrollCarousel'
import { ProductIntroSection } from '@/components/sections/ProductIntroSection'
import { UserGroupSection } from '@/components/sections/UserGroupSection'
import { features } from '@/content/features'

export function LandingPage() {
  return (
    <div className="min-h-svh overflow-x-clip bg-background">
      <SiteHeader />
      <main>
        <ProductIntroSection />
        <FeatureScrollCarousel features={features} />
        <CtaSection />
        <UserGroupSection />
        <AppComingSoonSection />
      </main>
      <SiteFooter />
    </div>
  )
}
