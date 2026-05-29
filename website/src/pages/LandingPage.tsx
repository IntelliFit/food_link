import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { AppComingSoonSection } from '@/components/sections/AppComingSoonSection'
import { CtaSection } from '@/components/sections/CtaSection'
import { FeatureSection } from '@/components/sections/FeatureSection'
import { ProductIntroSection } from '@/components/sections/ProductIntroSection'
import { features } from '@/content/features'

export function LandingPage() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main>
        <ProductIntroSection />
        {features.map((feature, index) => (
          <FeatureSection key={feature.id} feature={feature} reversed={index % 2 === 1} />
        ))}
        <CtaSection />
        <AppComingSoonSection />
      </main>
      <SiteFooter />
    </div>
  )
}
