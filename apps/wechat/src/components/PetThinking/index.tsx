import { View, Text } from '@tarojs/components'
import type { PetProfile, PetStatus } from '../../utils/api'
import { PetAvatar } from '../PetAvatar'
import { petThinkingView } from './pet-thinking-view'
import './index.scss'

/**
 * 「宠物思考中」：宠物在动，下面一行是它此刻真正在做的事（来自后端的进度），做完的步骤打勾。
 * 伙伴聊天等回答、首页「吃这个」卡片等推荐，都用这一个，不再只显示三个点。
 */
export function PetThinking({ pet, status, steps, size = 'chat', dark, fallback }: {
  pet?: PetProfile | null
  status?: PetStatus | null
  /** 已经发生的步骤，最新的在最后 */
  steps: readonly string[]
  size?: 'chat' | 'card' | 'inline'
  dark?: boolean
  /** 还没有任何步骤时显示的话 */
  fallback?: string
}) {
  const view = petThinkingView(steps, fallback)
  return (
    <View className={`pet-thinking pet-thinking--${size} ${dark ? 'pet-thinking--dark' : ''}`} aria-role='status' aria-label={view.current}>
      {size === 'inline' ? null : (
        <View className='pet-thinking__avatar'>
          <PetAvatar pet={pet} size={size === 'card' ? 56 : 44} mood={status?.mood} state={status?.state} motion='companion' />
        </View>
      )}
      <View className='pet-thinking__copy'>
        {view.done.map((step) => (
          <View key={step} className='pet-thinking__done'>
            <Text className='pet-thinking__tick'>✓</Text>
            <Text className='pet-thinking__done-text'>{step}</Text>
          </View>
        ))}
        <View className='pet-thinking__current'>
          <Text className='pet-thinking__current-text'>{view.current}</Text>
          <View className='pet-thinking__dots'>
            <View className='pet-thinking__dot' />
            <View className='pet-thinking__dot' />
            <View className='pet-thinking__dot' />
          </View>
        </View>
      </View>
    </View>
  )
}
