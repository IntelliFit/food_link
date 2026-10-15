import { Video } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { ModeIntroArtwork, type ModeIntroArtworkProps } from './ModeIntroArtwork'

let sequence = 0
export function ModeIntroMedia({ chapter, attempt, paused, onEnded, onError }: Pick<ModeIntroArtworkProps, 'chapter' | 'attempt'> & { paused: boolean; onEnded: () => boolean; onError: (message: string) => void }) {
  const [src, setSrc] = useState(''), [progressed, setProgressed] = useState(false), [id] = useState(() => `intro-motion-${++sequence}`)
  const live = useRef(true), desired = useRef(!paused), ended = useRef(false), pendingEnd = useRef(false)
  desired.current = !paused
  const play = () => { Taro.nextTick(() => { if (live.current && desired.current && !ended.current) Taro.createVideoContext(id).play() }) }
  useEffect(() => {
    if (paused || progressed) return
    const timeout = setTimeout(() => { if (live.current) onError('动画资源未能就绪，请重试或继续阅读。') }, 18000)
    return () => clearTimeout(timeout)
  }, [paused, progressed, onError])
  useEffect(() => { live.current = true; return () => { live.current = false; Taro.createVideoContext(id).pause() } }, [id])
  useEffect(() => {
    if (!src) return
    if (paused) Taro.createVideoContext(id).pause()
    else if (pendingEnd.current) { if (onEnded()) { pendingEnd.current = false; ended.current = true } }
    else play()
  }, [paused, src, onEnded])
  return <>
    <ModeIntroArtwork chapter={chapter} attempt={attempt} onPosterLoad={() => undefined} onMediaReady={value => { if (live.current) setSrc(value) }} onError={message => { if (live.current) onError(message) }} />
    {src && <Video key={src} id={id} className={`mode-introduction__video${progressed ? ' is-visible' : ''}`} src={src} autoplay={!paused} muted controls={false} objectFit='contain'
      showCenterPlayBtn={false} showPlayBtn={false} showFullscreenBtn={false} showProgress={false} showBottomProgress={false} showMuteBtn={false} enablePlayGesture={false} enableProgressGesture={false}
      pageGesture={false} vslideGesture={false} enableAutoRotation={false} autoPauseIfNavigate autoPauseIfOpenNative
      onLoadedMetaData={play} onPlay={() => { if (!desired.current) Taro.createVideoContext(id).pause() }}
      onTimeUpdate={event => { if (live.current && event.detail.currentTime > 0) setProgressed(true) }}
      onEnded={() => { if (live.current && !ended.current) { if (desired.current && onEnded()) ended.current = true; else pendingEnd.current = true } }}
      onError={() => { if (live.current) onError('动画播放暂时不可用，请重试或继续阅读。') }}
    />}
  </>
}
