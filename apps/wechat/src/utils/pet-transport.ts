import type { PetProfile } from './api'
import { petMotionAtlas } from './pet-motion'

export type PetTransportId = 'walk' | 'bicycle' | 'scooter' | 'skateboard'
export const PET_TRANSPORTS: { id: PetTransportId; name: string; description: string; mark: string }[] = [
  { id: 'bicycle', name: '自行车', description: '坐稳握把，轻松滑行', mark: '◉—◉' },
  { id: 'scooter', name: '滑板车', description: '双手握把，站姿出发', mark: '┐◉' },
  { id: 'skateboard', name: '滑板', description: '蹬地、收脚，平衡滑行', mark: '⌒' },
  { id: 'walk', name: '散步', description: '用自己的步伐慢慢走', mark: '↝' },
]
const keys = ['guigui', 'jianwen', 'huatuo', 'taiji', 'xiaomai', 'doudou']
export function petTransportAppearance(pet?: Partial<PetProfile> | null, sprite?: string): string {
  return sprite || pet?.builtin_avatar_id || pet?.pixel_avatar_url || ''
}
export function petTransportAsset(pet?: Partial<PetProfile> | null, sprite?: string): string | undefined {
  const key = petMotionAtlas(pet, sprite)?.match(/^\/assets\/pets\/motions\/(\w+)-motion-v1\.png$/)?.[1]
  return key && keys.includes(key) ? `/assets/pets/transport/${key}-transport-v1.png` : undefined
}
export function petTransportCapabilities(pet?: Partial<PetProfile> | null, sprite?: string): PetTransportId[] {
  // Legacy/photo motion v1 contains no scooter or skateboard poses.
  return petTransportAsset(pet, sprite) ? PET_TRANSPORTS.map(item => item.id) : ['walk']
}
export function defaultPetTransport(pet?: Partial<PetProfile> | null, sprite?: string): PetTransportId {
  return petTransportAsset(pet, sprite) ? 'bicycle' : 'walk'
}
