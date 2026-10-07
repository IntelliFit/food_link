import { View } from '@tarojs/components'
import './PetEntryIcon.scss'

export type PetEntryIconName = 'water' | 'exercise' | 'work' | 'rest' | 'snack' | 'ball' | 'home' | 'growth' | 'collection' | 'story' | 'bicycle' | 'scooter' | 'skateboard' | 'walk' | 'adventure' | 'merge'

// Native views keep the line icons crisp without depending on a device font or image request.
export function PetEntryIcon({ name }: { name: PetEntryIconName }) {
  return <View className={`pet-entry-icon is-${name}`}>
    {[1, 2, 3, 4, 5].map(part => <View key={part} className={`pet-entry-icon__stroke is-${part}`} />)}
  </View>
}
