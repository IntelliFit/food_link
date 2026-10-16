import type { SyntheticEvent } from 'react'

type Event = SyntheticEvent<HTMLElement> & { detail?: { src?: string; errMsg?: string } }
export type ModeIntroArtworkProps = {
  chapter: { packageRoot: string; file: string }; attempt: number
  motion?: boolean
  onPosterLoad: () => void; onMediaReady: (src: string) => void; onError: (message: string) => void
}

/** The native image and file copy execute inside the resource's own subpackage. */
export function ModeIntroArtwork({ chapter, attempt, motion = true, onPosterLoad, onMediaReady, onError }: ModeIntroArtworkProps) {
  const ready = (event: Event) => { if (event.detail?.src) onMediaReady(event.detail.src) }
  const failed = (event: Event) => onError(event.detail?.errMsg || '动画资源暂时不可用')
  // Taro discovers native bindings only from explicit literal JSX properties.
  if (chapter.packageRoot === 'packageModeIntroCover') return <mode-intro-cover asset={chapter.file} attempt={attempt} motion={motion} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
  if (chapter.packageRoot === 'packageModeIntroA') return <mode-intro-a asset={chapter.file} attempt={attempt} motion={motion} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
  if (chapter.packageRoot === 'packageModeIntroB') return <mode-intro-b asset={chapter.file} attempt={attempt} motion={motion} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
  return <mode-intro-c asset={chapter.file} attempt={attempt} motion={motion} sceneclass='mode-introduction__poster' onPosterload={onPosterLoad} onMediaready={ready} onError={failed} />
}
