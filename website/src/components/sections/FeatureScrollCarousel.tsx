import { useEffect, useRef, useState } from 'react'
import type { FeatureBlock } from '@/content/features'
import { FeaturePanel } from '@/components/sections/FeaturePanel'
import { FeatureSection } from '@/components/sections/FeatureSection'
import { cn } from '@/lib/utils'

type FeatureScrollCarouselProps = {
  features: FeatureBlock[]
}

/** 三步圆点指示 */
function CarouselDots({
  count,
  activeIndex,
}: {
  count: number
  activeIndex: number
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-4 md:bottom-10"
      role="tablist"
      aria-label={`功能亮点，共 ${count} 项，当前第 ${activeIndex + 1} 项`}
    >
      <div className="flex items-center gap-2">
        {Array.from({ length: count }, (_, index) => {
          const isActive = index === activeIndex
          const isPast = index < activeIndex

          return (
            <span
              key={index}
              role="tab"
              aria-selected={isActive}
              className={cn(
                'rounded-full transition-all duration-300',
                isActive && 'size-2.5 bg-primary shadow-[0_0_0_4px_rgb(0_188_125_/_0.2)]',
                isPast && 'size-2 bg-primary/70',
                !isActive && !isPast && 'size-2 bg-muted-foreground/30',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

export function FeatureScrollCarousel({ features }: FeatureScrollCarouselProps) {
  const containerRef = useRef<HTMLElement>(null)
  const [progress, setProgress] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [useStaticLayout, setUseStaticLayout] = useState(false)

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mobileQuery = window.matchMedia('(max-width: 767px)')

    const syncLayoutMode = () => {
      // 移动端与减少动效时回退纵向布局，避免 scroll-jacking 影响触控体验
      setUseStaticLayout(motionQuery.matches || mobileQuery.matches)
    }

    syncLayoutMode()
    motionQuery.addEventListener('change', syncLayoutMode)
    mobileQuery.addEventListener('change', syncLayoutMode)

    return () => {
      motionQuery.removeEventListener('change', syncLayoutMode)
      mobileQuery.removeEventListener('change', syncLayoutMode)
    }
  }, [])

  useEffect(() => {
    if (useStaticLayout) return

    let rafId = 0

    const update = () => {
      const container = containerRef.current
      if (!container) return

      const scrollable = container.offsetHeight - window.innerHeight
      if (scrollable <= 0) return

      const top = container.getBoundingClientRect().top
      const nextProgress = Math.min(1, Math.max(0, -top / scrollable))

      setProgress(nextProgress)

      const segmentCount = features.length - 1
      const nextIndex =
        segmentCount === 0
          ? 0
          : Math.min(features.length - 1, Math.round(nextProgress * segmentCount))
      setActiveIndex(nextIndex)
    }

    const onScroll = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [features.length, useStaticLayout])

  if (useStaticLayout) {
    return (
      <>
        {features.map((feature, index) => (
          <FeatureSection key={feature.id} feature={feature} reversed={index % 2 === 1} />
        ))}
      </>
    )
  }

  const panelCount = features.length
  const translateVw = progress * (panelCount - 1) * 100

  return (
    <section
      ref={containerRef}
      aria-label="产品功能亮点"
      className="relative"
      style={{ height: `${panelCount * 100}vh` }}
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-muted/40">
        <div
          className="absolute inset-0 opacity-80 transition-opacity duration-500"
          style={{
            background: `linear-gradient(135deg, rgb(0 188 125 / ${6 + activeIndex * 3}%) 0%, transparent 55%)`,
          }}
          aria-hidden
        />

        <div
          className="flex h-full will-change-transform"
          style={{
            width: `${panelCount * 100}vw`,
            transform: `translate3d(-${translateVw}vw, 0, 0)`,
          }}
        >
          {features.map((feature, index) => (
            <article
              key={feature.id}
              className="flex h-full w-screen shrink-0 items-center py-16 md:py-0"
              aria-hidden={index !== activeIndex}
            >
              <FeaturePanel feature={feature} reversed={index % 2 === 1} />
            </article>
          ))}
        </div>

        <CarouselDots count={features.length} activeIndex={activeIndex} />
      </div>
    </section>
  )
}
