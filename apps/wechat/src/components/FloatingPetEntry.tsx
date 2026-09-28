import { Text, View } from '@tarojs/components'
import { useDidHide, useDidShow, usePageScroll } from '@tarojs/taro'
import { useState } from 'react'
import { PetAvatar } from './PetAvatar'
import type { PetProfile } from '../utils/api'
import { openPetChat } from '../utils/pet-navigation'
import './FloatingPetEntry.scss'

/** The header owns the pet at the top. Scrolling brings the same companion into reach. */
export function FloatingPetEntry({ pet, mood, state, suppressed, reminder, onReminderPress }: { pet?: PetProfile; mood?: string; state?: string; suppressed?: boolean; reminder?: { text: string }; onReminderPress: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const [visible, setVisible] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  usePageScroll(({ scrollTop }) => setScrolled(scrollTop > 220))
  useDidShow(() => setVisible(true))
  useDidHide(() => setVisible(false))
  if (!pet || !visible || !scrolled || suppressed) return null
  return <View className={`floating-pet-entry${collapsed ? ' is-collapsed' : ''}`}>
    {collapsed ? <View className='floating-pet-entry__restore' role='button' aria-label='展开宠物助手' onClick={() => setCollapsed(false)}>‹</View> : <>
      {reminder && <View className='floating-pet-entry__reminder' role='button' onClick={onReminderPress}><Text>{reminder.text}</Text></View>}
      <View className='floating-pet-entry__pet' role='button' aria-label={`和${pet.name || '伙伴'}聊一聊`} onClick={() => openPetChat()}><PetAvatar pet={pet} size={54} mood={mood} state={state} /><Text>聊一聊</Text></View>
      <View className='floating-pet-entry__collapse' role='button' aria-label='收起悬浮宠物' onClick={() => setCollapsed(true)}>›</View>
    </>}
  </View>
}
