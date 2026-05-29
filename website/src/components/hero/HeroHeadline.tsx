import { productIntro } from '@/content/product-intro'

/** Hero 主标题：含「饮食」浅蓝高亮与「一张照片」绿色下划线 */
export function HeroHeadline() {
  const { headline } = productIntro

  return (
    <h1 className="space-y-0.5 text-[1.75rem] font-semibold leading-[1.32] tracking-[0.06em] text-foreground sm:space-y-1 sm:text-4xl sm:leading-[1.34] sm:tracking-[0.05em] md:text-5xl md:leading-[1.36] lg:text-[3.25rem] lg:leading-[1.38]">
      <span className="block">{headline.line1}</span>
      <span className="block">
        {headline.line2Prefix}
        <span className="rounded-md bg-macro-protein/15 px-1.5 py-0.5">{headline.line2Highlight}</span>
      </span>
      <span className="block">
        {headline.line3Prefix}
        <span className="hero-headline-underline text-primary">{headline.line3Highlight}</span>
      </span>
    </h1>
  )
}
