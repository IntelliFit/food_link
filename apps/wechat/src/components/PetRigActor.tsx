import { Canvas, Image, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { boardingPose, rigPose, type PetRig } from '../utils/pet-rig'
import { drawPetRig } from '../utils/pet-rig-render'
import type { PetMotionAction } from '../utils/pet-motion'
import type { PetTransportId } from '../utils/pet-transport'
import type { PetLoadout } from '../utils/pet-loadout'
import './PetRigActor.scss'

type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement; requestAnimationFrame: (callback: (timestamp: number) => void) => number; cancelAnimationFrame: (frame: number) => void; __petRigFrame?: { phase: number; stage: string; clock: number; handoff?: string; progress: number; rideAlpha: number; debug: { active: boolean; appHidden: boolean; pageHidden: boolean; presented: boolean; acknowledged: boolean; id: number; ticks: number } } }
let canvasSerial = 0

/** One clock drives both the character's joints and the tool's pedals. No frame-by-frame React updates. */
export function PetRigActor({ rig, vehicle, action = 'idle', active = true, visible = true, facing = 'right', showGround = false, standingScarf, handoff, handoffId = 0, handoffAcknowledged = true, handoffMs = 320, onPresented, onHandoffComplete, onReady, onUnavailable }: {
  rig: PetRig; vehicle?: PetTransportId; action?: PetMotionAction; active?: boolean; visible?: boolean; facing?: 'left' | 'right'; showGround?: boolean
  handoff?: 'boarding' | 'alighting'; handoffId?: number; handoffAcknowledged?: boolean; handoffMs?: number; onPresented?: () => void; onHandoffComplete?: () => void; onReady?: () => void; onUnavailable?: () => void
  standingScarf?: PetLoadout['scarf']
}) {
  const [id] = useState(() => `pet-rig-${++canvasSerial}`)
  const [ready, setReady] = useState(false)
  const options = useRef({ vehicle, action, active, visible, facing, showGround, handoff, handoffId, handoffMs, onPresented, onHandoffComplete, onReady, onUnavailable })
  options.current = { vehicle, action, active, visible, facing, showGround, handoff, handoffId, handoffMs, onPresented, onHandoffComplete, onReady, onUnavailable }
  const unavailable = useRef<() => void>()
  const paint = useRef<((reset?: boolean) => void) | null>(null)
  const paintedRig = useRef<PetRig>()
  const presentationAck = useRef('')
  const presentationKey = `${handoffId}:${handoff}`
  if (!visible || !handoffAcknowledged || presentationAck.current !== presentationKey) presentationAck.current = ''
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
  useEffect(() => {
    let current = true
    paint.current?.()
    // A RAF requested while the native hidden flag is still committed can be
    // discarded. Restart only after the shown node has reached the native view.
    if (visible && paint.current) Taro.nextTick(() => { if (current) paint.current?.() })
    return () => { current = false }
  }, [active, visible, facing, handoff, handoffId, handoffMs])
  useEffect(() => {
    let current = true
    if (visible && handoff === 'boarding' && handoffAcknowledged) Taro.nextTick(() => {
      if (current) { presentationAck.current = presentationKey; paint.current?.() }
    })
    return () => { current = false }
  }, [visible, handoff, handoffId, handoffAcknowledged, presentationKey])
  useEffect(() => {
    let disposed = false, hidden = false, frame = 0, clock = 0, last = 0, timer: ReturnType<typeof setTimeout> | undefined
    let currentHandoff: typeof handoff, currentHandoffId = handoffId, handoffElapsed = 0, handoffEpoch = 0, presented = false, completed = false, ticks = 0
    let handoffTimer: ReturnType<typeof setTimeout> | undefined, handoffLast: number | undefined
    let canvas: MiniCanvas | undefined, image: HTMLImageElement | undefined, armImage: HTMLImageElement | undefined, scarfImage: HTMLImageElement | undefined
    let reduce = false
    const stop = () => { if (canvas && frame) canvas.cancelAnimationFrame(frame); clearTimeout(handoffTimer); handoffTimer = undefined; handoffLast = undefined; frame = 0; last = 0 }
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
        if (standingScarf && rig.key === 'guigui') scarfImage = canvas.createImage()
        const start = () => {
          if (disposed || !canvas || !image) return
          const draw = () => {
            const current = options.current
            // Some native canvas layers ignore ancestor visibility/opacity.
            // A standby layer must contain no pixels, even before its hidden flag commits.
            if (!current.visible) {
              ctx.clearRect(0, 0, 200, 220)
              if (process.env.NODE_ENV === 'development') canvas!.__petRigFrame = undefined
              return
            }
            const pose = rigPose(rig, current.vehicle, current.action, reduce ? 0 : clock)
            const acknowledged = current.handoff !== 'boarding' || presentationAck.current === `${current.handoffId}:${current.handoff}`
            const progress = current.handoff ? !acknowledged ? 0 : reduce ? 1 : Math.min(1, handoffElapsed / Math.max(1, current.handoffMs)) : 1
            const rideAlpha = current.handoff === 'boarding' ? progress : current.handoff === 'alighting' ? 1 - progress : 1
            const mirrorAxis = 100 + (rig.frame[0] + rig.frame[2] / 2 - rig.hip.x) * pose.scale * (current.handoff === 'alighting' ? 1 - rideAlpha : 0)
            ctx.save()
            try {
              ctx.globalAlpha = current.handoff && rideAlpha === 0 ? 0 : 1
              if (current.facing === 'left') { ctx.translate(mirrorAxis * 2, 0); ctx.scale(-1, 1) }
              drawPetRig(ctx, image!, rig, current.handoff ? boardingPose(rig, pose, rideAlpha) : pose, current.vehicle, current.showGround, armImage, rideAlpha)
            } finally { ctx.restore() }
            if (current.handoff) {
              // Paint the exact original frame only at the standing endpoint. In
              // between, one skeleton changes pose; two faces never overlap.
              const [x, y, width, height] = rig.frame
              ctx.save()
              if (current.facing === 'left') { ctx.translate(mirrorAxis * 2, 0); ctx.scale(-1, 1) }
              const left = 100 + (x - rig.hip.x) * pose.scale, top = pose.floor + (y - rig.floor) * pose.scale
              if (rideAlpha === 0) ctx.drawImage(image!, x, y, width, height, left, top, width * pose.scale, height * pose.scale)
              if (scarfImage) {
                ctx.globalAlpha = 1 - rideAlpha
                const boxWidth = width * pose.scale * .34, boxHeight = height * pose.scale * .19
                const aspect = (scarfImage.naturalWidth || scarfImage.width || 1) / (scarfImage.naturalHeight || scarfImage.height || 1)
                const scarfWidth = Math.min(boxWidth, boxHeight * aspect), scarfHeight = scarfWidth / aspect
                ctx.drawImage(scarfImage, left + width * pose.scale * .34 + (boxWidth - scarfWidth) / 2, top + height * pose.scale * .34 + (boxHeight - scarfHeight) / 2, scarfWidth, scarfHeight)
              }
              ctx.restore()
            }
            // Read-only native QA metadata; no clock injection or React updates.
            if (process.env.NODE_ENV === 'development') canvas!.__petRigFrame = { phase: pose.phase, stage: pose.stage, clock, handoff: current.handoff, progress, rideAlpha, debug: { active: current.active, appHidden: hidden, pageHidden: pageHidden.current, presented, acknowledged, id: current.handoffId, ticks } }
          }
          const notifyHandoff = () => {
            const current = options.current, epoch = handoffEpoch
            if (!current.visible || !current.handoff) return
            if (!presented) {
              presented = true
              Taro.nextTick(() => { if (!disposed && epoch === handoffEpoch && options.current.visible && options.current.handoff === current.handoff && options.current.handoffId === current.handoffId) options.current.onPresented?.() })
            }
            const acknowledged = current.handoff !== 'boarding' || presentationAck.current === `${current.handoffId}:${current.handoff}`
            if (!completed && acknowledged && (reduce || handoffElapsed >= current.handoffMs)) {
              completed = true
              Taro.nextTick(() => { if (!disposed && epoch === handoffEpoch && options.current.visible && options.current.handoff === current.handoff && options.current.handoffId === current.handoffId) options.current.onHandoffComplete?.() })
            }
          }
          const tick = (timestamp: number) => {
            frame = 0
            ticks += 1
            const current = options.current
            if (disposed || hidden || pageHidden.current || !current.visible || reduce || !current.active && (!current.handoff || completed)) {
              if (canvas?.__petRigFrame) { canvas.__petRigFrame.debug.ticks = ticks; canvas.__petRigFrame.debug.appHidden = hidden; canvas.__petRigFrame.debug.pageHidden = pageHidden.current }
              last = 0; return
            }
            // Preserve the real cadence at 10–20 fps too. Capping every frame
            // at 50ms made a normal stride take several seconds on a busy device.
            // Hide/pause clears last; only unexplained long stalls are discarded.
            if (last) {
              const delta = Math.max(0, timestamp - last)
              if (current.active) clock += delta <= 1000 ? delta : 50
            }
            last = timestamp; draw(); notifyHandoff()
            if (!disposed && options.current.visible && options.current.active && !options.current.handoff) frame = canvas!.requestAnimationFrame(tick)
          }
          const tickHandoff = () => {
            handoffTimer = undefined
            const current = options.current
            if (disposed || hidden || pageHidden.current || !current.visible || !current.handoff || reduce || completed) return
            const now = Date.now(), acknowledged = current.handoff !== 'boarding' || presentationAck.current === `${current.handoffId}:${current.handoff}`
            if (acknowledged && handoffLast !== undefined) handoffElapsed += Math.max(0, now - handoffLast)
            handoffLast = acknowledged ? now : undefined
            ticks += 1; draw(); notifyHandoff()
            if (!disposed && options.current.visible && options.current.handoff && !completed) handoffTimer = setTimeout(tickHandoff, 16)
          }
          paint.current = reset => {
            stop()
            if (reset) clock = 0
            if (currentHandoff !== options.current.handoff || currentHandoffId !== options.current.handoffId) {
              currentHandoff = options.current.handoff; currentHandoffId = options.current.handoffId; handoffElapsed = 0; handoffEpoch += 1; presented = false; completed = false
            }
            draw()
            if (reduce) notifyHandoff()
            if (!disposed && !hidden && !pageHidden.current && options.current.visible && !reduce) {
              if (options.current.handoff && !completed) {
                // This short crossfade must advance while pedalling is paused.
                // Native RAF delivery on a previously hidden, paused canvas is
                // unreliable; one finite timer paints the same prepared bitmap.
                handoffLast = options.current.handoff !== 'boarding' || presentationAck.current === `${options.current.handoffId}:${options.current.handoff}` ? Date.now() : undefined
                handoffTimer = setTimeout(tickHandoff, 16)
              } else if (options.current.active && (options.current.vehicle || options.current.action !== 'idle')) frame = canvas!.requestAnimationFrame(tick)
            }
          }
          paint.current(true); paintedRig.current = rig; setReady(true)
        }
        const sources = [image, ...(armImage ? [armImage] : []), ...(scarfImage ? [scarfImage] : [])]
        let loaded = 0
        sources.forEach(source => { source.onerror = fail; source.onload = () => { if (++loaded === sources.length) start() } })
        image.src = rig.src
        if (armImage && rig.armSource) armImage.src = rig.armSource.src
        if (scarfImage && standingScarf) scarfImage.src = `/assets/pets/clothing/${standingScarf === 'cozy-scarf' ? 'cozy-scarf' : 'explorer-scarf'}.png`
      })
    }
    timer = setTimeout(connect, 30)
    return () => {
      disposed = true; clearTimeout(timer); stop(); paint.current = null; paintedRig.current = undefined; unavailable.current = undefined
      if (image) { image.onload = null; image.onerror = null }
      if (armImage) { armImage.onload = null; armImage.onerror = null }
      if (scarfImage) { scarfImage.onload = null; scarfImage.onerror = null }
      media?.removeEventListener?.('change', motionPreference)
      Taro.offAppHide?.(hide); Taro.offAppShow?.(show)
    }
  }, [id, rig, standingScarf])
  const [left, top, width, height] = rig.frame
  const isSheet = rig.key === 'guigui' || rig.key === 'jianwen'
  return <View className={`pet-rig${ready ? ' is-ready' : ''}${active ? '' : ' is-paused'}`} data-character={rig.key} data-source={rig.src} data-motion={vehicle || action} data-facing={facing}>
    <View className='pet-rig__fallback' style={{ visibility: visible && !ready ? 'visible' : 'hidden' }}><Image src={rig.src} className='pet-rig__source' mode='scaleToFill' onError={onUnavailable} style={isSheet ? { width: '400%', height: rig.key === 'jianwen' ? '200%' : '100%', transform: `translate(${-left / width * 100}%, ${-top / height * 100}%)` } : undefined} /></View>
    <Canvas type='2d' id={id} className='pet-rig__canvas' hidden={ready && !visible} style={{ opacity: visible && ready ? 1 : 0, visibility: visible ? 'visible' : 'hidden' }} onError={() => unavailable.current?.()} />
  </View>
}
