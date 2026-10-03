import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { PetProfile } from '../utils/api'
import { PetActor } from './PetActor'
import { PetRideBicycle, petRideAnchors } from './PetRideBicycle'
import { petMotionAtlas } from '../utils/pet-motion'
import { PET_TRANSPORTS, petTransportAsset, petTransportCapabilities, type PetTransportId } from '../utils/pet-transport'
import './PetTransportActor.scss'

/** Preview and departure share one coordinate plane; the ground stays with the selected tool. */
export function PetTransportActor({ pet, sprite, vehicle, size = 100, active = true, showStatus = false, showGround = false, onUnavailable }: {
  pet?: Partial<PetProfile> | null; sprite?: string; vehicle: PetTransportId; size?: number; active?: boolean; showStatus?: boolean; showGround?: boolean; onUnavailable?: () => void
}) {
  const [failed, setFailed] = useState('')
  const [windowWidth] = useState(() => { try { return (typeof Taro.getWindowInfo === 'function' ? Taro.getWindowInfo() : Taro.getSystemInfoSync()).windowWidth || 375 } catch { return 375 } })
  const src = petTransportAsset(pet, sprite)
  const rideAtlas = petMotionAtlas(pet, sprite)
  const fit = petRideAnchors(petMotionAtlas(pet, sprite))
  const supported = petTransportCapabilities(pet, sprite).includes(vehicle)
  const unavailable = !supported || (vehicle !== 'walk' && failed === (vehicle === 'bicycle' ? rideAtlas : src))
  const mode = unavailable ? 'walk' : vehicle
  const label = PET_TRANSPORTS.find(item => item.id === mode)!.name
  const boardBottom = src?.includes('/taiji-') ? 114 : src?.includes('/xiaomai-') ? 118 : 116
  return <View className={`pet-transport-actor is-${mode}${active ? '' : ' is-paused'}`} style={{ width: `${size}px`, height: `${size * 1.1}px` }} data-vehicle={mode} role='img' aria-label={`${pet?.name || '伙伴'}，${label}`}>
    <View className='pet-transport-actor__plane' style={{ transform: `scale(${size * 750 / (windowWidth * 200)})` }}>
      {showGround && <View className='pet-transport-actor__ground' style={{ top: `${mode === 'bicycle' && fit ? fit.foot.y + 25 : mode === 'skateboard' ? (boardBottom + 1) * 200 / 128 : mode === 'scooter' ? 183 : 163}rpx` }} />}
      {mode === 'scooter' || mode === 'skateboard' ? <View className='pet-transport-actor__clip'><Image className='pet-transport-actor__sheet' src={src!} mode='scaleToFill' onError={() => { setFailed(src!); onUnavailable?.() }} /></View>
        : mode === 'bicycle' && fit ? <><View className='pet-transport-actor__bike-rider'><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} size={78 * windowWidth / 375} action='ride' coasting active={active} holdPoseWhenPaused onMotionUnavailable={() => { setFailed(rideAtlas!); onUnavailable?.() }} /></View><PetRideBicycle fit={fit} /></>
          : <View className='pet-transport-actor__walker'><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} followLoadout size={85 * windowWidth / 375} action='walk' active={active} holdPoseWhenPaused unavailableAtlas={failed} /></View>}
    </View>
    {showStatus && unavailable ? <Text className='pet-transport-actor__status'>{supported ? '出行动作暂不可用，先陪你散步' : '当前形象暂未准备这套出行动作'}</Text> : null}
  </View>
}
