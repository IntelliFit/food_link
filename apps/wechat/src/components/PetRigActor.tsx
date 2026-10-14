import { Canvas, Image, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { rigPose, type PetRig } from '../utils/pet-rig'
import { drawPetRig } from '../utils/pet-rig-render'
import type { PetMotionAction } from '../utils/pet-motion'
import type { PetTransportId } from '../utils/pet-transport'
import './PetRigActor.scss'

type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement; requestAnimationFrame: (callback: (timestamp: number) => void) => number; cancelAnimationFrame: (frame: number) => void; __petRigFrame?: { phase: number; stage: string; clock: number } }
let canvasSerial = 0

/** One clock drives both the character's joints and the tool's pedals. No frame-by-frame React updates. */
export function PetRigActor({ rig, vehicle, action = 'idle', active = true, visible = true, facing = 'right', showGround = false, onReady, onUnavailable }: {
  rig: PetRig; vehicle?: PetTransportId; action?: PetMotionAction; active?: boolean; visible?: boolean; facing?: 'left' | 'right'; showGround?: boolean; onReady?: () => void; onUnavailable?: () => void
}) {
  const [id] = useState(() => `pet-rig-${++canvasSerial}`)
  const [ready, setReady] = useState(false)
  const options = useRef({ vehicle, action, active, visible, facing, showGround, onReady, onUnavailable })
  options.current = { vehicle, action, active, visible, facing, showGround, onReady, onUnavailable }
  const unavailable = useRef<() => void>()
  const paint = useRef<((reset?: boolean) => void) | null>(null)
  const paintedRig = useRef<PetRig>()
  const pageHidden = useRef(false)
  Taro.useDidHide(() => { pageHidden.current = true; paint.current?.() })
  Taro.useDidShow(() => { pageHidden.current = false; paint.current?.() })
  useEffect(() => {
    paint.current?.(true)
    if (!ready || paintedRig.current !== rig) return
    let current = true
    Taro.nextTick(() => { if (current) options.current.onReady?.() })
    return () => { current = false }
  }, [vehicle, action, showGround, ready, rig])
  useEffect(() => { paint.current?.() }, [active, visible, facing])
  useEffect(() => {
    let disposed = false, hidden = false, frame = 0, clock = 0, last = 0, timer: ReturnType<typeof setTimeout> | undefined
    let canvas: MiniCanvas | undefined, image: HTMLImageElement | undefined, armImage: HTMLImageElement | undefined
    let reduce = false
    const stop = () => { if (canvas && frame) canvas.cancelAnimationFrame(frame); frame = 0; last = 0 }
    const hide = () => { hidden = true; stop() }
    const show = () => { hidden = false; paint.current?.() }
    const motionPreference = (event: { matches: boolean }) => { reduce = event.matches; stop(); paint.current?.() }
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    reduce = Boolean(media?.matches); media?.addEventListener?.('change', motionPreference)
    Taro.onAppHide?.(hide); Taro.onAppShow?.(show)
    setReady(false)
    const fail = () => { if (!disposed) { stop(); setReady(false); options.current.onUnavailable?.() } }
    unavailable.current = fail
    const connect = (attempt = 0) => {
      if (disposed) return
      if (typeof Taro.createSelectorQuery !== 'function') { fail(); return }
      Taro.createSelectorQuery().select(`#${id}`).fields({ node: true, size: true }).exec(rows => {
        if (disposed) return
        const row = rows?.[0]
        if (!row?.node || !row.width || !row.height) {
          if (attempt < 4) timer = setTimeout(() => connect(attempt + 1), 100)
          else fail()
          return
        }
        canvas = row.node as MiniCanvas
        const pixelRatio = Math.min(3, Taro.getSystemInfoSync().pixelRatio || 2)
        canvas.width = row.width * pixelRatio; canvas.height = row.height * pixelRatio
        const ctx = canvas.getContext('2d')
        if (!ctx) { fail(); return }
        const unit = canvas.height / 220
        ctx.translate((canvas.width - 200 * unit) / 2, 0); ctx.scale(unit, unit)
        image = canvas.createImage()
        if (rig.armSource) armImage = canvas.createImage()
        const start = () => {
          if (disposed || !canvas || !image) return
          const draw = () => {
            const current = options.current
            // Some native canvas layers ignore ancestor visibility/opacity.
            // A standby layer must contain no pixels, even before its hidden flag commits.
            if (!current.visible) { ctx.clearRect(0, 0, 200, 220); return }
            const pose = rigPose(rig, current.vehicle, current.action, reduce ? 0 : clock)
            ctx.save()
            try {
              if (current.facing === 'left') { ctx.translate(200, 0); ctx.scale(-1, 1) }
              drawPetRig(ctx, image!, rig, pose, current.vehicle, current.showGround, armImage)
            } finally { ctx.restore() }
            // Read-only native QA metadata; no clock injection or React updates.
            if (process.env.NODE_ENV === 'development') canvas!.__petRigFrame = { phase: pose.phase, stage: pose.stage, clock }
          }
          const tick = (timestamp: number) => {
            frame = 0
            if (disposed || hidden || pageHidden.current || !options.current.active || !options.current.visible || reduce) { last = 0; return }
            // Preserve the real cadence at 10–20 fps too. Capping every frame
            // at 50ms made a normal stride take several seconds on a busy device.
            // Hide/pause clears last; only unexplained long stalls are discarded.
            if (last) {
              const delta = Math.max(0, timestamp - last)
              clock += delta <= 1000 ? delta : 50
            }
            last = timestamp; draw()
            frame = canvas!.requestAnimationFrame(tick)
          }
          paint.current = reset => {
            stop(); if (reset) clock = 0; draw()
            if (!disposed && !hidden && !pageHidden.current && options.current.active && options.current.visible && !reduce && (options.current.vehicle || options.current.action !== 'idle')) frame = canvas!.requestAnimationFrame(tick)
          }
          paint.current(true); paintedRig.current = rig; setReady(true)
        }
        const sources = [image, ...(armImage ? [armImage] : [])]
        let loaded = 0
        sources.forEach(source => { source.onerror = fail; source.onload = () => { if (++loaded === sources.length) start() } })
        image.src = rig.src
        if (armImage && rig.armSource) armImage.src = rig.armSource.src
      })
    }
    timer = setTimeout(connect, 30)
    return () => {
      disposed = true; clearTimeout(timer); stop(); paint.current = null; paintedRig.current = undefined; unavailable.current = undefined
      if (image) { image.onload = null; image.onerror = null }
      if (armImage) { armImage.onload = null; armImage.onerror = null }
      media?.removeEventListener?.('change', motionPreference)
      Taro.offAppHide?.(hide); Taro.offAppShow?.(show)
    }
  }, [id, rig])
  const [left, top, width, height] = rig.frame
  const isSheet = rig.key === 'guigui' || rig.key === 'jianwen'
  return <View className={`pet-rig${ready ? ' is-ready' : ''}${active ? '' : ' is-paused'}`} data-character={rig.key} data-source={rig.src} data-motion={vehicle || action} data-facing={facing}>
    <View className='pet-rig__fallback' style={{ visibility: visible && !ready ? 'visible' : 'hidden' }}><Image src={rig.src} className='pet-rig__source' mode='scaleToFill' onError={onUnavailable} style={isSheet ? { width: '400%', height: rig.key === 'jianwen' ? '200%' : '100%', transform: `translate(${-left / width * 100}%, ${-top / height * 100}%)` } : undefined} /></View>
    <Canvas type='2d' id={id} className='pet-rig__canvas' hidden={ready && !visible} style={{ opacity: visible && ready ? 1 : 0, visibility: visible ? 'visible' : 'hidden' }} onError={() => unavailable.current?.()} />
  </View>
}
