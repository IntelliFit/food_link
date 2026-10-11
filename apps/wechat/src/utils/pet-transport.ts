import type { PetProfile } from './api'
import { PET_RIGS, petRig } from './pet-rig'

export type PetTransportId = 'walk' | 'bicycle' | 'scooter' | 'skateboard'
export const PET_TRANSPORTS: { id: PetTransportId; name: string; description: string; mark: string }[] = [
  { id: 'bicycle', name: '自行车', description: '双脚交替踩踏，坐稳握把', mark: '◉—◉' },
  { id: 'scooter', name: '滑板车', description: '单脚支撑，蹬地收脚再滑行', mark: '┐◉' },
  { id: 'skateboard', name: '滑板', description: '蹬地、收脚，平衡滑行', mark: '⌒' },
  { id: 'walk', name: '散步', description: '用自己的步伐慢慢走', mark: '↝' },
]
export function petTransportAppearance(pet?: Partial<PetProfile> | null, sprite?: string): string {
  return sprite || pet?.builtin_avatar_id || pet?.pixel_avatar_url || ''
}
function hasTransportRig(pet?: Partial<PetProfile> | null, sprite?: string): boolean {
  const rig = petRig(pet, sprite)
  return Boolean(rig && Object.prototype.hasOwnProperty.call(PET_RIGS, rig.key))
}
export function petTransportCapabilities(pet?: Partial<PetProfile> | null, sprite?: string): PetTransportId[] {
  // Only a rig bound to this exact appearance can use the shared vehicle motions.
  // Photo motion v1 keeps its own walk without borrowing another character's body.
  return hasTransportRig(pet, sprite) ? PET_TRANSPORTS.map(item => item.id) : ['walk']
}
export function defaultPetTransport(pet?: Partial<PetProfile> | null, sprite?: string): PetTransportId {
  return hasTransportRig(pet, sprite) ? 'bicycle' : 'walk'
}
