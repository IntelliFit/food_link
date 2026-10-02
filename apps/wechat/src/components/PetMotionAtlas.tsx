import { Image, View } from '@tarojs/components'
import type { PetMotionAction } from '../utils/pet-motion'
import './PetMotionAtlas.scss'

/** The atlas belongs to the selected appearance; CSS advances poses without per-frame React work. */
export function PetMotionAtlas({ src, action, active, onError }: { src: string; action: PetMotionAction; active: boolean; onError?: () => void }) {
  return <View className={`pet-motion-atlas pet-motion-atlas--${action}${src.startsWith('/assets/pets/motions/') ? ' pet-motion-atlas--packed' : ''}${active ? '' : ' is-paused'}`} data-action={action}>
    <Image className='pet-motion-atlas__sheet' src={src} mode='scaleToFill' onError={onError} />
  </View>
}
