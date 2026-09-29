import { Image, Video, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import * as React from 'react'
import './ThemeSceneBackground.scss'

let sceneVideoSequence = 0

/** A rendered scene clip replaces its still image; no effects are overlaid on the artwork. */
export function ThemeSceneBackground({ poster, src, active, className = 'bt-scene' }: { poster?: string; src?: string; active: boolean; className?: string }) {
  const [playbackSrc, setPlaybackSrc] = React.useState<string>()
  const [playing, setPlaying] = React.useState(false)
  const [progressed, setProgressed] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [videoId] = React.useState(() => `theme-scene-video-${++sceneVideoSequence}`)
  React.useEffect(() => {
    let cancelled = false
    setPlaybackSrc(undefined)
    setFailed(false)
    if (!src || !active) return () => { cancelled = true }
    const getEnv = (Taro as unknown as { getEnv?: () => string }).getEnv
    if (typeof getEnv !== 'function' || getEnv() !== Taro.ENV_TYPE.WEAPP) {
      setPlaybackSrc(src)
      return () => { cancelled = true }
    }
    try {
      const userDataPath = String((Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH || '')
      if (!userDataPath) throw new Error('USER_DATA_PATH is unavailable')
      const fileName = src.split('/').filter(Boolean).pop() || 'theme-scene.mp4'
      const localSrc = `${userDataPath}/${fileName}`
      const fs = Taro.getFileSystemManager()
      try { fs.accessSync(localSrc) } catch { fs.copyFileSync(src, localSrc) }
      if (!cancelled) setPlaybackSrc(localSrc)
    } catch {
      if (!cancelled) setFailed(true)
    }
    return () => { cancelled = true }
  }, [active, src])
  const play = React.useCallback(() => {
    if (!playbackSrc || !active) return
    Taro.nextTick(() => Taro.createVideoContext(videoId).play())
  }, [active, playbackSrc, videoId])
  React.useEffect(() => {
    setPlaying(false)
    setProgressed(false)
    if (!playbackSrc || !active) return
    const firstRetry = setTimeout(play, 120)
    const secondRetry = setTimeout(play, 700)
    return () => { clearTimeout(firstRetry); clearTimeout(secondRetry) }
  }, [active, play, playbackSrc])
  const showVideo = Boolean(playbackSrc && active && !failed)
  if (!poster && !showVideo) return null
  return <View className={`${className} bt-scene-background${showVideo ? ' has-video-source' : ''}${playing ? ' has-started' : ''}${progressed ? ' has-progressed' : ''}${failed ? ' has-failed' : ''}`} aria-hidden>
    {poster && <Image className='bt-scene-background__poster' src={poster} mode='aspectFill' />}
    {showVideo && <Video id={videoId} key={playbackSrc} className={`bt-scene-background__video${playing ? ' is-playing' : ''}`}
      src={playbackSrc!} autoplay loop muted controls={false} objectFit='cover'
      showCenterPlayBtn={false} showPlayBtn={false} showFullscreenBtn={false} showProgress={false}
      showBottomProgress={false} showMuteBtn={false} enablePlayGesture={false} enableProgressGesture={false}
      pageGesture={false} vslideGesture={false} enableAutoRotation={false}
      autoPauseIfNavigate autoPauseIfOpenNative
      onLoadedMetaData={play}
      onPlay={() => setPlaying(true)}
      onTimeUpdate={progressed ? undefined : event => { if (event.detail.currentTime > 0) { setPlaying(true); setProgressed(true) } }}
      onError={() => { setPlaying(false); setFailed(true) }}
    />}
  </View>
}
