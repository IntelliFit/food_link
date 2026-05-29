import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { brand } from '@/content/brand'
import { mainNav } from '@/content/navigation'
import { ExperienceButton } from '@/components/ui/ExperienceButton'
import { cn } from '@/lib/utils'

const MORPH_MS = 520
const MORPH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const COMPACT_GAP = 16
const PILL_PAD_X = 24
const PILL_PAD_Y = 16
const TOP_BAR_HEIGHT = 70
const PILL_RADIUS = 24

type HeaderLayout = {
  logoLeft: number
  navLeft: number
  ctaLeft: number
  pillWidth: number
  pillLeft: number
  barHeight: number
}

const defaultLayout: HeaderLayout = {
  logoLeft: 0,
  navLeft: 0,
  ctaLeft: 0,
  pillWidth: 0,
  pillLeft: 0,
  barHeight: TOP_BAR_HEIGHT,
}

function NavLinks({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <nav
      className={cn(
        'flex items-center',
        compact ? 'gap-3 md:gap-4' : 'gap-5 md:gap-8',
        className,
      )}
      aria-label="主导航"
    >
      {mainNav.map((item) =>
        item.isAnchor ? (
          <a
            key={item.to}
            href={item.to}
            className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.to}
            to={item.to}
            className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  )
}

function BrandMark() {
  return (
    <>
      <img
        src={brand.assets.loginLogo}
        alt=""
        aria-hidden
        className="size-6 shrink-0 rounded-[6px] object-contain"
      />
      <span className="whitespace-nowrap text-base font-bold tracking-tight text-foreground md:text-lg">
        {brand.shortName}
      </span>
    </>
  )
}

export function SiteHeader() {
  const [atTop, setAtTop] = useState(true)
  const [morphEnabled, setMorphEnabled] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLAnchorElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<HeaderLayout>(defaultLayout)

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY === 0)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current
      const logo = logoRef.current
      const nav = navRef.current
      const cta = ctaRef.current
      if (!container || !logo || !nav || !cta) return

      const cw = container.offsetWidth
      const logoW = logo.offsetWidth
      const navW = nav.offsetWidth
      const ctaW = cta.offsetWidth
      const contentH = Math.max(logo.offsetHeight, nav.offsetHeight, cta.offsetHeight)
      const barHeight = atTop ? TOP_BAR_HEIGHT : contentH + PILL_PAD_Y * 2

      if (atTop) {
        setLayout({
          logoLeft: 0,
          navLeft: Math.max((cw - navW) / 2, 0),
          ctaLeft: Math.max(cw - ctaW, 0),
          pillWidth: 0,
          pillLeft: cw / 2,
          barHeight,
        })
        return
      }

      const groupW = logoW + COMPACT_GAP + navW + COMPACT_GAP + ctaW
      const pillWidth = groupW + PILL_PAD_X * 2
      const pillLeft = Math.max((cw - pillWidth) / 2, 0)
      const contentLeft = pillLeft + PILL_PAD_X

      setLayout({
        logoLeft: contentLeft,
        navLeft: contentLeft + logoW + COMPACT_GAP,
        ctaLeft: contentLeft + logoW + COMPACT_GAP + navW + COMPACT_GAP,
        pillWidth,
        pillLeft,
        barHeight,
      })
    }

    measure()

    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)

    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [atTop])

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMorphEnabled(true))
    })
  }, [])

  const morphStyle = morphEnabled
    ? ({
        transitionDuration: `${MORPH_MS}ms`,
        transitionTimingFunction: MORPH_EASE,
      } as const)
    : ({ transitionDuration: '0ms' } as const)

  return (
    <header
      className={cn(
        'pointer-events-none fixed inset-x-0 z-50 px-4 md:px-8',
        atTop ? 'top-0' : 'top-2',
      )}
      style={{ transitionProperty: 'top', ...morphStyle }}
    >
      <div
        ref={containerRef}
        className="relative mx-auto max-w-6xl transition-[height]"
        style={{
          height: layout.barHeight,
          ...morphStyle,
        }}
      >
        {/* Pill background — extra vertical padding via barHeight, not larger controls */}
        <div
          aria-hidden
          className="absolute inset-y-0 bg-primary/10 backdrop-blur-xl"
          style={{
            left: layout.pillLeft,
            width: layout.pillWidth,
            borderRadius: atTop ? 0 : PILL_RADIUS,
            opacity: atTop ? 0 : 1,
            transitionProperty: morphEnabled ? 'left, width, opacity, border-radius' : 'none',
            ...morphStyle,
          }}
        />

        <Link
          ref={logoRef}
          to="/#hero"
          className="pointer-events-auto absolute top-1/2 flex -translate-y-1/2 items-center gap-2"
          style={{
            left: layout.logoLeft,
            transitionProperty: morphEnabled ? 'left' : 'none',
            ...morphStyle,
          }}
        >
          <BrandMark />
        </Link>

        <nav
          ref={navRef}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2"
          style={{
            left: layout.navLeft,
            transitionProperty: morphEnabled ? 'left' : 'none',
            ...morphStyle,
          }}
        >
          <NavLinks compact={!atTop} />
        </nav>

        <div
          ref={ctaRef}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2"
          style={{
            left: layout.ctaLeft,
            transitionProperty: morphEnabled ? 'left' : 'none',
            ...morphStyle,
          }}
        >
          <ExperienceButton variant="simple" />
        </div>
      </div>
    </header>
  )
}
