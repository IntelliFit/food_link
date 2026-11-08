import React from 'react'
import { Text, View } from '@tarojs/components'
import { PetAvatar } from '../PetAvatar'
import './index.scss'

export type PetThinkingPet = React.ComponentProps<typeof PetAvatar>['pet']

type Props = {
  /** The user's own partner; PetAvatar falls back to the default look. */
  pet?: PetThinkingPet | null
  /** Real progress labels, newest last. The newest is said in the bubble, earlier ones show as done. */
  steps: string[]
  size?: 'card' | 'chat'
  /** The user hid the partner: show the words only. */
  hidePet?: boolean
  dark?: boolean
}

// "宠物思考中": the shared wait state for the home meal card and the partner chat.
// It only reports what is really happening; it never delays an answer.
export default function PetThinking({ pet, steps, size = 'card', hidePet = false, dark = false }: Props) {
  const current = steps[steps.length - 1] || ''
  const done = steps.slice(0, -1)
  return (
    <View className={`pet-thinking pet-thinking--${size}${dark ? ' pet-thinking--dark' : ''}`} aria-label={current}>
      <View className='pet-thinking__row'>
        {!hidePet && (
          <View className='pet-thinking__pet'>
            <PetAvatar pet={pet || undefined} size={size === 'chat' ? 44 : 58} motion='companion' />
          </View>
        )}
        <View key={current} className={`pet-thinking__bubble${hidePet ? ' pet-thinking__bubble--plain' : ''}`}>
          <Text>{current}</Text>
        </View>
      </View>
      {done.length > 0 && (
        <View className='pet-thinking__done'>
          {done.map(step => (
            <View key={step} className='pet-thinking__done-step'>
              <Text className='pet-thinking__tick'>✓</Text>
              <Text>{step.replace(/[…。.]+$/, '')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
