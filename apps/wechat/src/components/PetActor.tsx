import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import type { PetProfile } from '@food-link/core'
import { PetAvatar } from './PetAvatar'
import { getCompanionSprite } from './PetCompanionSprite'
import { getHomeCompanionPreference, getHomeCompanionSpriteOverride, HOME_COMPANION_CHANGED_EVENT, JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from '../utils/pet-companion-preference'
import { PET_LOADOUT_CHANGED, readPetLoadout } from '../utils/pet-loadout'
import './PetActor.scss'

export type PetAction = 'idle' | 'walk' | 'jump' | 'wave' | 'celebrate' | 'observe' | 'cook' | 'blink'
export interface PetActorProps {
  pet?: Partial<PetProfile> | null; size?: number; action?: PetAction; active?: boolean
  followAppearance?: boolean; spriteOverride?: string; showStatus?: boolean
  scarf?: 'cozy-scarf' | 'explorer-scarf' | null
}

/** A requested action never replaces the selected character with another character's frames. */
export function petActionCapabilities(pet?: Partial<PetProfile> | null, sprite?: string): PetAction[] {
  if (sprite === ORIGINAL_COMPANION_SRC) return ['idle', 'walk']
  if (sprite === JIANWEN_COMPANION_SRC) return ['idle', 'walk', 'blink', 'wave', 'observe', 'celebrate']
  return ['idle', ...(pet?.pixel_avatar_blink_url ? ['blink' as const] : []), ...(pet?.pixel_avatar_jump_url ? ['jump' as const] : [])]
}

export function PetActor({ pet, size = 96, action = 'idle', active = true, followAppearance = true, spriteOverride, showStatus = false, scarf }: PetActorProps) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const sync = () => refresh(value => value + 1)
    Taro.eventCenter.on(HOME_COMPANION_CHANGED_EVENT, sync)
    Taro.eventCenter.on(PET_LOADOUT_CHANGED, sync)
    return () => { Taro.eventCenter.off(HOME_COMPANION_CHANGED_EVENT, sync); Taro.eventCenter.off(PET_LOADOUT_CHANGED, sync) }
  }, [])
  const sprite = spriteOverride || (followAppearance ? getHomeCompanionSpriteOverride(getHomeCompanionPreference()) : undefined) || getCompanionSprite(pet || undefined)
  const capabilities = petActionCapabilities(pet, sprite)
  const supported = capabilities.includes(action)
  const pose = active && supported ? action : 'idle'
  const loadout = followAppearance && pet?.id ? readPetLoadout(pet.id, sprite || pet.builtin_avatar_id || pet.pixel_avatar_url || '') : null
  const clothing = scarf === undefined ? loadout?.scarf : scarf
  const width = sprite ? size * 160 / 208 : size
  const customFrame = pose === 'blink' ? pet?.pixel_avatar_blink_url : pose === 'jump' ? pet?.pixel_avatar_jump_url : undefined
  return <View className={`pet-actor pet-actor--${sprite === JIANWEN_COMPANION_SRC ? 'jianwen' : sprite ? 'original' : 'custom'} pet-actor--${pose}${active ? '' : ' pet-actor--paused'}`} style={{ width: `${width}px`, height: `${size}px` }} role='img' aria-label={`${pet?.name || '伙伴'}，${supported ? action : '原有形象'}`}>
    {sprite ? <View className='pet-actor__frame'><Image className='pet-actor__sheet' src={sprite} mode='scaleToFill' lazyLoad={false} /></View> : customFrame ? <Image className='pet-actor__custom' src={customFrame} mode='aspectFit' /> : <PetAvatar pet={pet} size={size} motion='static' active={active} />}
    {sprite === ORIGINAL_COMPANION_SRC && clothing && <Image className='pet-actor__scarf' src={clothing === 'cozy-scarf' ? '/assets/pets/clothing/cozy-scarf.png' : '/assets/pets/clothing/explorer-scarf.png'} mode='aspectFit' />}
    {showStatus && !supported && <Text className='pet-actor__status'>这套形象暂未提供此动作</Text>}
  </View>
}
