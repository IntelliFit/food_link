import { LegalDocumentLayout } from '@/components/layout/LegalDocumentLayout'

export function BlogPage() {
  return (
    <LegalDocumentLayout title="博客" updatedAt="2026年">
      <section className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
          博客内容筹备中，敬请期待。
        </p>
      </section>
    </LegalDocumentLayout>
  )
}
