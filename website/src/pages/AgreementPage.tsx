import { agreementDocument } from '@/content/agreement'
import { LegalDocumentLayout } from '@/components/layout/LegalDocumentLayout'

export function AgreementPage() {
  return (
    <LegalDocumentLayout title={agreementDocument.title} updatedAt={agreementDocument.updatedAt}>
      {agreementDocument.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
          <div className="flex flex-col gap-4">
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground md:text-base">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </LegalDocumentLayout>
  )
}
