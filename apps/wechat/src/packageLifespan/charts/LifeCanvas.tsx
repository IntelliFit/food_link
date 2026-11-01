import { Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef } from 'react'
import type { Ctx } from './draw'

interface Surface {
  ctx: Ctx
  width: number
  height: number
  ratio: number
}

interface LifeCanvasProps {
  id: string
  className?: string
  /** Redraws whenever a value in `deps` changes. */
  deps: unknown[]
  draw: (ctx: Ctx, width: number, height: number) => void
}

const MAX_ATTEMPTS = 10

function devicePixelRatio(): number {
  try {
    return Taro.getWindowInfo?.().pixelRatio || Taro.getSystemInfoSync().pixelRatio || 2
  } catch {
    return 2
  }
}

export function LifeCanvas({ id, className, deps, draw }: LifeCanvasProps) {
  const surface = useRef<Surface | null>(null)
  const latestDraw = useRef(draw)
  latestDraw.current = draw

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const paint = () => {
      const target = surface.current
      if (!target) return
      target.ctx.setTransform(target.ratio, 0, 0, target.ratio, 0, 0)
      target.ctx.clearRect(0, 0, target.width, target.height)
      latestDraw.current(target.ctx, target.width, target.height)
    }
    const connect = () => {
      if (surface.current) { paint(); return }
      Taro.createSelectorQuery().select(`#${id}`).fields({ node: true, size: true }).exec((result) => {
        if (cancelled) return
        const found = result?.[0]
        if (!found?.node || !found.width) {
          attempts += 1
          if (attempts < MAX_ATTEMPTS) setTimeout(connect, 60)
          return
        }
        const ratio = devicePixelRatio()
        found.node.width = found.width * ratio
        found.node.height = found.height * ratio
        surface.current = { ctx: found.node.getContext('2d'), width: found.width, height: found.height, ratio }
        paint()
      })
    }
    void Taro.nextTick(connect)
    return () => { cancelled = true }
    // deps are supplied by the caller; the latest draw is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return <Canvas type='2d' id={id} className={className} />
}
