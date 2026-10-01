import { View, Text } from '@tarojs/components'
import { openPetStudio } from '../../utils/pet-navigation'
import './studio-entry.scss'

export function PetChatStudioEntry() {
  return <View id='pet-chat-studio-entry' className='pet-chat-studio-entry' role='button' aria-label='打开宠物时光' onClick={openPetStudio}>
    <View className='pet-chat-studio-icon'><Text className='iconfont icon-all' /></View>
    <View className='pet-chat-studio-copy'>
      <Text className='pet-chat-studio-title'>宠物时光</Text>
      <Text className='pet-chat-studio-note'>换装 · 动作 · 游戏练习</Text>
    </View>
    <Text className='pet-chat-studio-link'>去看看 <Text>›</Text></Text>
  </View>
}
