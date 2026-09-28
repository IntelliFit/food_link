import { Image } from '@tarojs/components'
import * as React from 'react'
import { loadBalancedScenes } from '../utils/balanced-theme-scenes'

/** Decorative subpackage images never block the content or its click targets. */
export function ThemeSceneImage({ src, className, mode = 'scaleToFill' }: { src: string; className: string; mode?: 'scaleToFill' | 'aspectFit' }) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let active = true
    setReady(false)
    loadBalancedScenes().then(() => { if (active) setReady(true) }).catch(() => {})
    return () => { active = false }
  }, [src])
  return ready ? <Image className={className} src={src} mode={mode} aria-hidden onError={() => setReady(false)} /> : null
}
