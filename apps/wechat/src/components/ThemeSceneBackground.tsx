import { Image, Video, View } from '@tarojs/components'
import * as React from 'react'
import './ThemeSceneBackground.scss'

/** A rendered scene clip replaces its still image; no effects are overlaid on the artwork. */
export function ThemeSceneBackground({ poster, src, active, className = 'bt-scene' }: { poster?: string; src?: string; active: boolean; className?: string }) {
  const [playing, setPlaying] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => { setPlaying(false); setFailed(false) }, [src, active])
  const showVideo = Boolean(src && active && !failed)
  if (!poster && !showVideo) return null
  return <View className={`${className} bt-scene-background`} aria-hidden>
    {poster && <Image className='bt-scene-background__poster' src={poster} mode='aspectFill' />}
    {showVideo && <Video key={src} className={`bt-scene-background__video${playing ? ' is-playing' : ''}`}
      src={src!} autoplay loop muted controls={false} objectFit='cover'
      showCenterPlayBtn={false} showPlayBtn={false} showFullscreenBtn={false} showProgress={false}
      showBottomProgress={false} showMuteBtn={false} enablePlayGesture={false} enableProgressGesture={false}
      pageGesture={false} vslideGesture={false} enableAutoRotation={false}
      autoPauseIfNavigate autoPauseIfOpenNative
      onTimeUpdate={playing ? undefined : event => { if (event.detail.currentTime > 0) setPlaying(true) }}
      onError={() => { setPlaying(false); setFailed(true) }}
    />}
  </View>
}
