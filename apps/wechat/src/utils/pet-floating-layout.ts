import type { PetProfile } from './api'
import { petRig, rigPose } from './pet-rig'
import type { PetTransportId } from './pet-transport'

/** Preserve the approved source's pixel scale and ground contact when boarding. */
export function floatingPetLayout(pet: Partial<PetProfile> | null | undefined, sprite: string | undefined, vehicle: PetTransportId, windowWidth: number, unavailable = false) {
  const rpx = windowWidth / 750, standingSize = 156 * rpx, rig = petRig(pet, sprite)
  const frameHeight = rig?.frame[3] || 208, sourceScale = standingSize / frameHeight
  const hip = 20 * rpx + (rig?.hip.x || (sprite ? 80 : 104)) * sourceScale
  const ground = rig ? rig.floor * sourceScale : standingSize
  const walking = vehicle === 'walk' || !rig || unavailable
  if (!rig || unavailable) {
    const transportSize = standingSize / .85
    return { standingSize, transportSize, left: hip - transportSize / 2, top: -transportSize * .05, ground }
  }
  const pose = rigPose(rig, walking ? undefined : vehicle, walking ? 'walk' : 'ride', 0)
  const unit = sourceScale / pose.scale
  const transportSize = walking ? unit * 220 / .85 : unit * 200
  return { standingSize, transportSize, left: hip - transportSize / 2, top: ground - pose.floor * unit - (walking ? transportSize * .05 : 0), ground }
}
