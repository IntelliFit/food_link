import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import type { PetProfile } from '../utils/api'
import { PetActor } from './PetActor'
import { PetRigActor } from './PetRigActor'
import { getCompanionSprite } from './PetCompanionSprite'
import { petRig } from '../utils/pet-rig'
import { petMotionAtlas } from '../utils/pet-motion'
import { PET_TRANSPORTS, petTransportCapabilities, type PetTransportId } from '../utils/pet-transport'
import './PetTransportActor.scss'

/** Preview and departure share one coordinate plane; the ground stays with the selected tool. */
export function PetTransportActor({ pet, sprite, vehicle, size = 100, active = true, showStatus = false, showGround = false, onUnavailable }: {
  pet?: Partial<PetProfile> | null; sprite?: string; vehicle: PetTransportId; size?: number; active?: boolean; showStatus?: boolean; showGround?: boolean; onUnavailable?: () => void
}) {
  const [failed, setFailed] = useState('')
  const rig = petRig(pet, sprite)
  const rideAtlas = petMotionAtlas(pet, sprite)
  const supported = petTransportCapabilities(pet, sprite).includes(vehicle)
  const unavailable = !supported || vehicle !== 'walk' && !rig || Boolean(failed && failed === rig?.src)
  const mode = unavailable ? 'walk' : vehicle
  const walkerWidth = size * .85 * (sprite || getCompanionSprite(pet || undefined) ? 160 / 208 : 1)
  const label = PET_TRANSPORTS.find(item => item.id === mode)!.name
  return <View className={`pet-transport-actor is-${mode}${active ? '' : ' is-paused'}`} style={{ width: `${size}px`, height: `${size * 1.1}px` }} data-vehicle={mode} role='img' aria-label={`${pet?.name || '伙伴'}，${label}`}>
    <View className='pet-transport-actor__plane' style={{ width: `${size}px`, height: `${size * 1.1}px` }}>
      {showGround && mode === 'walk' && <View className='pet-transport-actor__ground' style={{ top: `${size * .815}px` }} />}
      {mode === 'walk' ? <View className='pet-transport-actor__walker' style={{ left: `${(size - walkerWidth) / 2}px`, top: `${size * .05}px` }}><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} followLoadout size={size * .85} action='walk' active={active} holdPoseWhenPaused unavailableAtlas={failed === rig?.src ? rideAtlas : failed} /></View>
        : rig && <PetRigActor rig={rig} vehicle={mode} action='ride' active={active} showGround={showGround} onUnavailable={() => { setFailed(rig.src); onUnavailable?.() }} />}
    </View>
    {showStatus && unavailable ? <Text className='pet-transport-actor__status'>{supported ? '出行动作暂不可用，先陪你散步' : '当前形象暂未准备这套出行动作'}</Text> : null}
  </View>
}
