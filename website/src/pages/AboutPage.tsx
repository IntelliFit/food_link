import { brand } from '@/content/brand'
import { LegalDocumentLayout } from '@/components/layout/LegalDocumentLayout'

export function AboutPage() {
  return (
    <LegalDocumentLayout title="关于我们" updatedAt="2026年">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{brand.fullName}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
          「食探」是一款致力于帮助用户通过拍照识别食物卡路里、记录日常饮食与运动、管理健康档案的智能助手。我们希望通过
          AI 技术，让健康管理变得更加简单、有趣且高效。无论你是想减脂、增肌还是维持健康，食探都能为你提供专业的分析与建议。
        </p>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{brand.companyName}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
          食探由 {brand.companyName} 提供产品与技术支持。
        </p>
      </section>
    </LegalDocumentLayout>
  )
}
