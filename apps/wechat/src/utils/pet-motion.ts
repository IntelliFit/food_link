import type { PetProfile } from './api'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from './pet-companion-preference'

export type PetMotionAction = 'idle' | 'walk' | 'jump' | 'wave' | 'celebrate' | 'observe' | 'cook' | 'blink' | 'ride'
export const PET_MOTION_ACTIONS: PetMotionAction[] = ['idle', 'blink', 'walk', 'wave', 'observe', 'cook', 'jump', 'celebrate', 'ride']
const builtinMotion: Record<string, string> = { 'jianwen-01': 'jianwen', 'huatuo-01': 'huatuo', 'taiji-xiaozi-01': 'taiji', 'xiaomai-01': 'xiaomai', 'doudou-01': 'doudou' }
export const PET_RIDE_CYCLE_MS = 800
export function petMotionAtlas(pet?: Partial<PetProfile> | null, sprite?: string): string | undefined {
  if (sprite && sprite !== ORIGINAL_COMPANION_SRC && sprite !== JIANWEN_COMPANION_SRC) return undefined
  const key = sprite === ORIGINAL_COMPANION_SRC ? 'guigui' : sprite === JIANWEN_COMPANION_SRC ? 'jianwen' : builtinMotion[pet?.builtin_avatar_id || '']
  if (key) return `/assets/pets/motions/${key}-motion-v1.png`
  // Version is a contract: legacy head-only avatars never pretend to be a full motion set.
  if (!sprite && !pet?.builtin_avatar_id && pet?.pixel_motion_version === 1 && pet.pixel_motion_atlas_url) return pet.pixel_motion_atlas_url
  return undefined
}
