import { Image, type ImageProps } from '@tarojs/components'
import * as React from 'react'

const sceneRoot = '/packageThemeScenes/assets/'
export function isPackagedScene(src?: string): boolean { return Boolean(src?.startsWith(sceneRoot)) }
type Props = { src: string; className: string; mode?: ImageProps['mode']; onLoad?: () => void; onError?: () => void }

/** Cross-package images are owned by the asynchronously loaded native component. */
export function SceneArtwork({ src, className, mode = 'scaleToFill', onLoad, onError }: Props) {
  if (!isPackagedScene(src)) return <Image src={src} className={className} mode={mode} aria-hidden onLoad={onLoad} onError={onError} />
  return <theme-scene-image className={className} sceneclass={className} asset={src.slice(sceneRoot.length)} mode={mode} onLoad={onLoad} onError={onError} />
}
