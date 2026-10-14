import { Image } from '@tarojs/components'
import * as React from 'react'
import { getBalancedScenesRevision, loadBalancedScenes, reportBalancedSceneImageError, subscribeBalancedScenes } from '../utils/balanced-theme-scenes'

/** Decorative subpackage images never block the content or its click targets. */
export function ThemeSceneImage({ src, className, mode = 'scaleToFill' }: { src: string; className: string; mode?: 'scaleToFill' | 'aspectFit' | 'aspectFill' }) {
  const [ready, setReady] = React.useState(false)
  const [revision, setRevision] = React.useState(getBalancedScenesRevision)
  React.useEffect(() => {
    let active = true
    setReady(false)
    const unsubscribe = subscribeBalancedScenes((nextRevision, imageError) => {
      if (active && !imageError) { setRevision(nextRevision); setReady(true) }
    })
    loadBalancedScenes().then(() => { if (active) setReady(true) }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [src])
  return ready ? <Image key={`${src}:${revision}`} className={className} src={src} mode={mode} aria-hidden onError={() => { setReady(false); reportBalancedSceneImageError() }} /> : null
}
