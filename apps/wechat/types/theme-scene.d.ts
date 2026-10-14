import type { HTMLAttributes } from 'react'

type SceneImageAttributes = HTMLAttributes<HTMLElement> & { asset: string; sceneclass: string; mode?: string }

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'theme-scene-image': SceneImageAttributes
      'theme-scene-nature-image': SceneImageAttributes
      'theme-scene-gallery-image': SceneImageAttributes
    }
  }
}
