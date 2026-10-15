import type { SyntheticEvent } from 'react'
import type { MODE_INTRODUCTION_CHAPTERS } from '../utils/mode-introduction-chapters'

type Event = SyntheticEvent<HTMLElement> & { detail?: { src?: string; errMsg?: string } }
export type ModeIntroArtworkProps = {
  chapter: typeof MODE_INTRODUCTION_CHAPTERS[number]; attempt: number
  onPosterLoad: () => void; onMediaReady: (src: string) => void; onError: (message: string) => void
}

/** The native image and file copy execute inside the resource's own subpackage. */
export function ModeIntroArtwork({ chapter, attempt, onPosterLoad, onMediaReady, onError }: ModeIntroArtworkProps) {
  const ready = (event: Event) => { if (event.detail?.src) onMediaReady(event.detail.src) }
  const failed = (event: Event) => onError(event.detail?.errMsg || '动画资源暂时不可用')
  // Taro discovers native bindings only from explicit literal JSX properties.
  if (chapter.packageRoot === 'packageModeIntroA') return <mode-intro-a asset={chapter.file} attempt={attempt} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
  if (chapter.packageRoot === 'packageModeIntroB') return <mode-intro-b asset={chapter.file} attempt={attempt} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
  return <mode-intro-c asset={chapter.file} attempt={attempt} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
}
