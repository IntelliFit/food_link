import { Canvas, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef } from 'react'
import lottie, { type LottieAnimation } from 'lottie-miniprogram'
import celebrationData from '../assets/animations/recap-celebration.json'

const CANVAS_ID = 'recapCelebrationCanvas'

type CanvasRow = {
  node?: HTMLCanvasElement
  width?: number
  height?: number
}

function pixelRatio(): number {
  try {
    const info = Taro.getWindowInfo?.()
    if (info?.pixelRatio) return info.pixelRatio
  } catch { /* Older base libraries do not expose getWindowInfo. */ }
  try { return Taro.getSystemInfoSync().pixelRatio || 1 } catch { return 1 }
}

/** One-shot celebration behind the report card. It never blocks the report actions. */
export function RecapCelebration({ loop = false }: { loop?: boolean }) {
  const animationRef = useRef<LottieAnimation | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let disposed = false
    timerRef.current = setTimeout(() => {
      Taro.createSelectorQuery()
        .select(`#${CANVAS_ID}`)
        .fields({ node: true, size: true })
        .exec(rows => {
          if (disposed) return
          const row = rows?.[0] as CanvasRow | undefined
          const canvas = row?.node
          const width = Number(row?.width || 0)
          const height = Number(row?.height || 0)
          if (!canvas || !width || !height) return

          try {
            const ratio = pixelRatio()
            canvas.width = Math.round(width * ratio)
            canvas.height = Math.round(height * ratio)
            lottie.setup(canvas)
            const context = canvas.getContext('2d')
            if (!context) return
            const animation = lottie.loadAnimation({
              loop,
              autoplay: true,
              // lottie-web mutates animationData while completing nested assets. The
              // report can remount after tab changes, so every playback needs a clone.
              animationData: JSON.parse(JSON.stringify(celebrationData)) as Record<string, unknown>,
              rendererSettings: { context, clearCanvas: true },
            })
            animationRef.current = animation
          } catch (error) {
            console.warn('[RecapCelebration] 礼花动画加载失败', error)
          }
        })
    }, 80)

    return () => {
      disposed = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      animationRef.current?.destroy()
      animationRef.current = null
    }
  }, [loop])

  return <View className='recap-celebration' aria-hidden>
    <Canvas id={CANVAS_ID} type='2d' className='recap-celebration__canvas' />
  </View>
}
