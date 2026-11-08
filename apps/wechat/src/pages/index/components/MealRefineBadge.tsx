import React from 'react'
import { Text, View } from '@tarojs/components'
import { PetAvatar } from '../../../components/PetAvatar'
import type { PetThinkingPet } from '../../../components/PetThinking'
import './MealRefineBadge.scss'

export type MealRefineState = 'updating' | 'refining' | 'done'

const REFINE_TEXT: Record<MealRefineState, string> = { updating: '在帮你更新…', refining: '我再帮你细挑…', done: '挑好了' }

// A small corner note while the card already shows food: the saved answer is
// being refreshed, or the model is still choosing in the background.
export default function MealRefineBadge({ pet, hidePet, state }: { pet?: PetThinkingPet | null; hidePet: boolean; state: MealRefineState }) {
  return (
    <View className={`meal-refine meal-refine--${state}`}>
      {!hidePet && <View className='meal-refine__pet'><PetAvatar pet={pet || undefined} size={30} /></View>}
      <Text className='meal-refine__text'>{REFINE_TEXT[state]}</Text>
    </View>
  )
}
