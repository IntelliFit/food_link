import type { HTMLAttributes } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'theme-scene-image': HTMLAttributes<HTMLElement> & { asset: string; sceneclass: string; mode?: string }
    }
  }
}
