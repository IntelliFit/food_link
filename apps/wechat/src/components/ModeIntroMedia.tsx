import { Video } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ModeIntroArtwork, type ModeIntroArtworkProps } from './ModeIntroArtwork'

let sequence = 0
/** One decoder for the current slide. Stay animated until the user swipes or pauses. */
export function ModeIntroMedia({ chapter, attempt, paused, onError }: Pick<ModeIntroArtworkProps, 'chapter' | 'attempt'> & { paused: boolean; onError: (message: string) => void }) {
  const [src, setSrc] = useState(''), [progressed, setProgressed] = useState(false), [id] = useState(() => `intro-motion-${++sequence}`)
  const live = useRef(true), desired = useRef(!paused), foreground = useRef(true), error = useRef(onError)
  const lastProgress = useRef(Date.now()), lastTime = useRef(-1), recovery = useRef<ReturnType<typeof setTimeout>>()
  desired.current = !paused; error.current = onError
  const play = useCallback(() => {
    Taro.nextTick(() => { if (live.current && foreground.current && desired.current) Taro.createVideoContext(id).play() })
  }, [id])
  const recover = () => {
    if (!live.current || !foreground.current || !desired.current || recovery.current) return
    recovery.current = setTimeout(() => { recovery.current = undefined; play() }, 350)
  }
  useDidHide(() => { foreground.current = false; Taro.createVideoContext(id).pause() })
  useDidShow(() => { foreground.current = true; lastProgress.current = Date.now(); if (src) play() })
  useEffect(() => {
    live.current = true
    return () => { live.current = false; clearTimeout(recovery.current); Taro.createVideoContext(id).pause() }
  }, [id])
  useEffect(() => {
    lastProgress.current = Date.now()
    if (paused) { clearTimeout(recovery.current); recovery.current = undefined; Taro.createVideoContext(id).pause(); return }
    if (!src) return
    play()
    // Native video creation can finish after React's first nextTick on real devices.
    const first = setTimeout(play, 120), second = setTimeout(play, 700)
    return () => { clearTimeout(first); clearTimeout(second) }
  }, [paused, src, play])
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (!live.current || !foreground.current || !desired.current) return
      const stalled = Date.now() - lastProgress.current
      if (stalled >= 18000) { lastProgress.current = Date.now(); error.current('动画未能继续播放，请重试。') }
      else if (src && stalled >= 3000) play()
    }, 1500)
    return () => clearInterval(watchdog)
  }, [src, play])
  return <>
    <ModeIntroArtwork chapter={chapter} attempt={attempt} onPosterLoad={() => undefined} onMediaReady={value => { if (live.current) setSrc(value) }} onError={message => { if (live.current) error.current(message) }} />
    {src && <Video key={src} id={id} className={`mode-introduction__video${progressed ? ' is-visible' : ''}`} src={src} autoplay={!paused} loop muted controls={false} objectFit='contain'
      showCenterPlayBtn={false} showPlayBtn={false} showFullscreenBtn={false} showProgress={false} showBottomProgress={false} showMuteBtn={false} enablePlayGesture={false} enableProgressGesture={false}
      pageGesture={false} vslideGesture={false} enableAutoRotation={false} autoPauseIfNavigate autoPauseIfOpenNative
      onLoadedMetaData={play} onPlay={() => { if (!desired.current || !foreground.current) Taro.createVideoContext(id).pause() }}
      onTimeUpdate={event => { if (live.current && event.detail.currentTime !== lastTime.current) { lastTime.current = event.detail.currentTime; lastProgress.current = Date.now(); if (event.detail.currentTime > 0) setProgressed(true) } }}
      onPause={recover} onWaiting={recover}
      onEnded={() => { if (live.current && foreground.current && desired.current) { Taro.createVideoContext(id).seek(0); play() } }}
      onError={() => { if (live.current) error.current('动画播放暂时不可用，请重试。') }}
    />}
  </>
}
