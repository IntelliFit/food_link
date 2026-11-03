import { Text, View } from '@tarojs/components'
import type { EatingMood } from '../../utils/api'
import { EATING_MOOD_OPTIONS } from '../../utils/eating-mood'
import './index.scss'

interface EatingMoodPickerProps {
  value: EatingMood | null
  onChange: (value: EatingMood | null) => void
}

/** 选填：再点一次已选中的心情可以取消。 */
export default function EatingMoodPicker({ value, onChange }: EatingMoodPickerProps) {
  return (
    <View className='eating-mood-options'>
      {EATING_MOOD_OPTIONS.map((option) => (
        <View
          key={option.value}
          className={`eating-mood-option ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(value === option.value ? null : option.value)}
        >
          <Text className='eating-mood-emoji'>{option.emoji}</Text>
          <Text className='eating-mood-label'>{option.label}</Text>
        </View>
      ))}
    </View>
  )
}
