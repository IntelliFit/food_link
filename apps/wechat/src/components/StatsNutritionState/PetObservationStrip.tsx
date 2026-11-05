import { Text, View } from '@tarojs/components'
import { PetAvatar } from '../PetAvatar'
import type { PetProfile } from '../../utils/api'

/** 分析页顶部：宠物把引擎的一句话说出来，点一下带着这句话去聊天 */
export function PetObservationStrip({ pet, mood, state, metaText, headline, petName, onAsk }: {
  pet?: PetProfile | null
  mood?: string
  state?: string
  metaText: string
  headline: string
  petName: string
  onAsk: () => void
}) {
  return (
    <View className='stats-card stats-ns-observation'>
      <View className='stats-ns-observation__avatar'>
        <PetAvatar pet={pet} size={56} mood={mood} state={state} />
      </View>
      <View className='stats-ns-observation__copy'>
        <Text className='stats-ns-observation__meta'>{metaText}</Text>
        <Text className='stats-ns-observation__headline'>{headline}</Text>
        <View className='stats-ns-observation__ask' aria-role='button' aria-label={`问问${petName}怎么改`} onClick={onAsk}>
          <Text>问问{petName}怎么改 →</Text>
        </View>
      </View>
    </View>
  )
}
