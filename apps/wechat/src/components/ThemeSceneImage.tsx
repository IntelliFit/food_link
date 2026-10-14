import * as React from 'react'
import { SceneArtwork } from './SceneArtwork'
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
  return ready ? <SceneArtwork key={`${src}:${revision}`} className={className} src={src} mode={mode} onError={() => { setReady(false); reportBalancedSceneImageError() }} /> : null
}
