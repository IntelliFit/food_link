import { Image, type ImageProps } from '@tarojs/components'
import * as React from 'react'
import { reportBalancedSceneImageError } from '../utils/balanced-theme-scenes'

const sceneRoots = ['/packageThemeScenes/assets/', '/packageThemeScenesNature/assets/', '/packageThemeScenesGallery/assets/']
export function isPackagedScene(src?: string): boolean { return Boolean(src && sceneRoots.some(root => src.startsWith(root))) }
type Props = { src: string; className: string; mode?: ImageProps['mode']; onLoad?: () => void; onError?: () => void }

/** Cross-package images are owned by the asynchronously loaded native component. */
export function SceneArtwork({ src, className, mode = 'scaleToFill', onLoad, onError }: Props) {
  if (!isPackagedScene(src)) return <Image src={src} className={className} mode={mode} aria-hidden onLoad={onLoad} onError={onError} />
  const sceneRoot = sceneRoots.find(root => src.startsWith(root))!
  const asset = src.slice(sceneRoot.length)
  const handleError = (event: React.SyntheticEvent<HTMLElement>) => {
    const detail = (event as unknown as { detail?: { errMsg?: string } })?.detail
    reportBalancedSceneImageError(`图片读取 ${asset}：${detail?.errMsg || '未返回原因'}`)
    onError?.()
  }
  // Literal tags let Taro register each native component's props and events.
  if (sceneRoot === sceneRoots[1]) return <theme-scene-nature-image
    className={className} sceneclass={className} asset={asset} mode={mode} onLoad={onLoad} onError={handleError}
  />
  if (sceneRoot === sceneRoots[2]) return <theme-scene-gallery-image
    className={className} sceneclass={className} asset={asset} mode={mode} onLoad={onLoad} onError={handleError}
  />
  return <theme-scene-image
    className={className} sceneclass={className} asset={asset} mode={mode} onLoad={onLoad} onError={handleError}
  />
}
