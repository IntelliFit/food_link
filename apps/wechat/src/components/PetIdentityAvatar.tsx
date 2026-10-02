import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState, type ComponentProps } from 'react'
import { PetAvatar } from './PetAvatar'
import { PetCompanionSprite } from './PetCompanionSprite'
import { PetActor } from './PetActor'
import { getStoredHomeExperienceConfig } from '../utils/home-experience'
import { getHomeCompanionPreference, getHomeCompanionSpriteOverride, HOME_COMPANION_CHANGED_EVENT } from '../utils/pet-companion-preference'
import './PetIdentityAvatar.scss'

/** Current-account surfaces share the desktop appearance; candidate previews never use this override. */
export function PetIdentityAvatar(props: ComponentProps<typeof PetAvatar>) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const sync = () => refresh(value => value + 1)
    Taro.eventCenter.on(HOME_COMPANION_CHANGED_EVENT, sync)
    return () => { Taro.eventCenter.off(HOME_COMPANION_CHANGED_EVENT, sync) }
  }, [])
  const src = props.pet && getHomeCompanionSpriteOverride(getHomeCompanionPreference())
  const height = typeof props.size === 'number' ? props.size : props.size === 'small' ? 54 : props.size === 'large' ? 132 : 82
  if (getStoredHomeExperienceConfig({ syncDisplay: false }).mode !== 'wellness') return <View className={`pet-identity-avatar ${props.className || ''}`} style={{ width: `${height}px`, height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PetActor pet={props.pet} size={height} /></View>
  if (!src) return <PetAvatar {...props} />
  return <View className='pet-identity-avatar' style={{ width: `${height}px`, height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: `${height * 160 / 208}px`, height: `${height}px` }}><PetCompanionSprite src={src} name={props.pet?.name} /></View>
  </View>
}
