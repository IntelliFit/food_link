import type { HTMLAttributes } from 'react'

type SceneImageAttributes = HTMLAttributes<HTMLElement> & { asset: string; sceneclass: string; mode?: string; onOwnerready?: () => void }
type IntroMediaAttributes = HTMLAttributes<HTMLElement> & { asset: string; attempt: number; motion: boolean; sceneclass: string; onPosterload: () => void; onMediaready: (event: any) => void }

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'mode-intro-a': IntroMediaAttributes
      'mode-intro-b': IntroMediaAttributes
      'mode-intro-c': IntroMediaAttributes
      'theme-scene-image': SceneImageAttributes
      'theme-scene-nature-image': SceneImageAttributes
      'theme-scene-gallery-image': SceneImageAttributes
    }
  }
}
