import * as React from 'react'
import { SceneArtwork } from './SceneArtwork'
import { useThemeSceneScope } from './ThemeSceneScope'
import { getBalancedScenesRevision, loadBalancedScenes, reportBalancedSceneImageError, reportBalancedSceneProgress, subscribeBalancedScenes } from '../utils/balanced-theme-scenes'

let imageSequence = 0
/** Decorative subpackage images never block the content or its click targets. */
export function ThemeSceneImage({ src, className, mode = 'scaleToFill' }: { src: string; className: string; mode?: 'scaleToFill' | 'aspectFit' | 'aspectFill' }) {
  const [ready, setReady] = React.useState(false)
  const [revision, setRevision] = React.useState(getBalancedScenesRevision)
  const scope = useThemeSceneScope()
  const [owner] = React.useState(() => `image-${++imageSequence}`)
  const identity = `${owner}:${scope}:${src}:${revision}`
  const current = React.useRef({ identity, active: true, phase: 'pending' })
  if (current.current.identity !== identity) current.current = { identity, active: true, phase: 'pending' }
  const attempt = current.current
  React.useEffect(() => {
    let active = true
    attempt.active = true
    const unsubscribe = subscribeBalancedScenes((nextRevision, imageError, _detail, progress) => {
      if (active && attempt.phase !== 'loaded' && progress && 'packageRoot' in progress && src.startsWith(`/${progress.packageRoot}/`)) {
        attempt.phase = 'error'
        reportBalancedSceneImageError(_detail, src, scope, identity)
      }
      if (active && !imageError && !progress) { setRevision(nextRevision); setReady(true) }
    })
    loadBalancedScenes().then(() => { if (active) setReady(true) }).catch(() => {})
    return () => { active = false; attempt.active = false; unsubscribe(); reportBalancedSceneProgress(src, 'disposed', scope, identity) }
  }, [src, scope, attempt])
  React.useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      if (attempt !== current.current || attempt.phase === 'loaded' || attempt.phase === 'error') return
      const phase = attempt.phase
      attempt.phase = 'error'
      reportBalancedSceneImageError(`${phase === 'ready' ? '图片等待超时' : '组件仍为占位'} ${src.split('/').pop()}：20 秒内未收到图片结果`, src, scope, identity)
    }, 20000)
    return () => clearTimeout(timer)
  }, [src, ready, attempt, scope])
  return ready ? <SceneArtwork key={identity} className={className} src={src} mode={mode}
    onOwnerReady={() => { if (attempt === current.current && attempt.active && attempt.phase !== 'loaded') { attempt.phase = 'ready'; reportBalancedSceneProgress(src, 'ready', scope, identity) } }}
    onLoad={() => { if (attempt === current.current && attempt.active) { attempt.phase = 'loaded'; reportBalancedSceneProgress(src, 'loaded', scope, identity) } }}
    onError={detail => { if (attempt === current.current && attempt.active) { attempt.phase = 'error'; reportBalancedSceneImageError(detail, src, scope, identity) } }}
  /> : null
}
