import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import type { PetProfile } from '../utils/api'
import { PetActor } from './PetActor'
import { PetRigActor } from './PetRigActor'
import { getCompanionSprite } from './PetCompanionSprite'
import { petRig } from '../utils/pet-rig'
import { petMotionAtlas } from '../utils/pet-motion'
import { PET_TRANSPORTS, petTransportCapabilities, type PetTransportId } from '../utils/pet-transport'
import type { PetLoadout } from '../utils/pet-loadout'
import './PetTransportActor.scss'

/** Preview and departure share one coordinate plane; the ground stays with the selected tool. */
export function PetTransportActor({ pet, sprite, vehicle, size = 100, active = true, visible = true, facing = 'right', showStatus = false, showGround = false, standingScarf, handoff, handoffId, handoffAcknowledged, handoffMs, onPresented, onHandoffComplete, onReady, onUnavailable }: {
  pet?: Partial<PetProfile> | null; sprite?: string; vehicle: PetTransportId; size?: number; active?: boolean; visible?: boolean; facing?: 'left' | 'right'; showStatus?: boolean; showGround?: boolean
  handoff?: 'boarding' | 'alighting'; handoffId?: number; handoffAcknowledged?: boolean; handoffMs?: number; onPresented?: () => void; onHandoffComplete?: () => void; onReady?: () => void; onUnavailable?: () => void
  standingScarf?: PetLoadout['scarf']
}) {
  const [failed, setFailed] = useState('')
  const rig = petRig(pet, sprite)
  useEffect(() => { setFailed('') }, [pet?.id, sprite, rig?.src])
  const rideAtlas = petMotionAtlas(pet, sprite)
  const supported = petTransportCapabilities(pet, sprite).includes(vehicle)
  const unavailable = !supported || vehicle !== 'walk' && !rig || Boolean(failed && failed === rig?.src)
  const mode = unavailable ? 'walk' : vehicle
  useEffect(() => { if (mode === 'walk') onReady?.() }, [mode, pet?.id, sprite, onReady])
  useEffect(() => { if (mode === 'walk' && visible && handoff) { onPresented?.(); onHandoffComplete?.() } }, [mode, visible, handoff, onPresented, onHandoffComplete])
  const walkerWidth = size * .85 * (sprite || getCompanionSprite(pet || undefined) ? 160 / 208 : 1)
  const label = PET_TRANSPORTS.find(item => item.id === mode)!.name
  return <View className={`pet-transport-actor is-${mode}${active ? '' : ' is-paused'}`} style={{ width: `${size}px`, height: `${size * 1.1}px`, visibility: visible ? 'visible' : 'hidden' }} data-vehicle={mode} role='img' aria-hidden={!visible} aria-label={`${pet?.name || '伙伴'}，${label}`}>
    <View className='pet-transport-actor__plane' style={{ width: `${size}px`, height: `${size * 1.1}px` }}>
      {showGround && mode === 'walk' && <View className='pet-transport-actor__ground' style={{ top: `${size * .815}px` }} />}
      {mode === 'walk' ? <View className='pet-transport-actor__walker' style={{ left: `${(size - walkerWidth) / 2}px`, top: `${size * .05}px` }}><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} followLoadout size={size * .85} action='walk' active={active} visible={visible} facing={facing} holdPoseWhenPaused unavailableAtlas={failed === rig?.src ? rideAtlas : failed} /></View>
        : rig && <PetRigActor rig={rig} vehicle={mode} action='ride' active={active} visible={visible} facing={facing} showGround={showGround} standingScarf={standingScarf} handoff={handoff} handoffId={handoffId} handoffAcknowledged={handoffAcknowledged} handoffMs={handoffMs} onPresented={onPresented} onHandoffComplete={onHandoffComplete} onReady={onReady} onUnavailable={() => { setFailed(rig.src); onUnavailable?.() }} />}
    </View>
    {showStatus && unavailable ? <Text className='pet-transport-actor__status'>{supported ? '出行动作暂不可用，先陪你散步' : '当前形象暂未准备这套出行动作'}</Text> : null}
  </View>
}
