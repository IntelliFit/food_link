import React from 'react'
import { Text, View } from '@tarojs/components'
import { PetAvatar } from '../../../components/PetAvatar'
import { petDisplayName } from '../../../utils/pet-name'
import './MealWaitingPet.scss'

export type MealPet = React.ComponentProps<typeof PetAvatar>['pet']

/** What the card is really doing while the user waits, in the order the server does it. */
export type MealWaitStage = 'locating' | 'searching' | 'scoring' | 'comparing'

const STAGE_STEP: Record<MealWaitStage, number> = { locating: 0, searching: 1, scoring: 2, comparing: 2 }
const STEP_LABELS = ['定位', '找店', '挑菜']

export function mealWaitText(stage: MealWaitStage, name: string): string {
  switch (stage) {
    case 'locating': return `${name}在确认你的位置…`
    case 'searching': return '在找你附近开着的店…'
    case 'scoring': return '在算你今天还差多少营养…'
    default: return '在比一比哪几道最合适…'
  }
}

type WaitProps = { pet?: MealPet; showPet: boolean; stage: MealWaitStage }

// The card's empty state while the first answer is on its way: the user's own
// partner hops in and says what is happening. It never delays the answer.
export function MealWaitingPet({ pet, showPet, stage }: WaitProps) {
  const name = petDisplayName(pet?.name)
  const step = STAGE_STEP[stage]
  return (
    <View className='meal-wait' aria-label={mealWaitText(stage, name)}>
      <View className='meal-wait__row'>
        {showPet && <View className='meal-wait__pet'><PetAvatar pet={pet} size={58} motion='companion' /></View>}
        <View key={stage} className={`meal-wait__bubble${showPet ? '' : ' meal-wait__bubble--plain'}`}>
          <Text>{mealWaitText(stage, name)}</Text>
        </View>
      </View>
      <View className='meal-wait__steps'>
        {STEP_LABELS.map((label, index) => (
          <View key={label} className={`meal-wait__step${index < step ? ' is-done' : ''}${index === step ? ' is-active' : ''}`}>
            <View className='meal-wait__step-dot' />
            <Text>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export type MealRefineState = 'updating' | 'refining' | 'done'

const REFINE_TEXT: Record<MealRefineState, string> = { updating: '在帮你更新…', refining: '我再帮你细挑…', done: '挑好了' }

// A small corner note while the card already shows food: the saved answer is
// being refreshed, or the model is still choosing in the background.
export function MealRefineBadge({ pet, showPet, state }: { pet?: MealPet; showPet: boolean; state: MealRefineState }) {
  return (
    <View className={`meal-refine meal-refine--${state}`}>
      {showPet && <View className='meal-refine__pet'><PetAvatar pet={pet} size={30} /></View>}
      <Text className='meal-refine__text'>{REFINE_TEXT[state]}</Text>
    </View>
  )
}
