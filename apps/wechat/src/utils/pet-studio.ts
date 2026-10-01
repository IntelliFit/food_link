import Taro from '@tarojs/taro'
import type { PetProfile, PetAppearanceCandidate } from './api'
import { getCompanionSprite } from '../components/PetCompanionSprite'
import { getHomeCompanionSpriteOverride, type HomeCompanionPreference } from './pet-companion-preference'

export const PET_STUDIO_DRESSING_KEY = 'pet_studio_dressing_v1'
export type StudioAction = 'idle' | 'walk' | 'hop'
export interface StudioCharacter {
  id: string
  name: string
  pet: Partial<PetProfile>
  sprite?: string
  current: boolean
}
export function buildStudioCharacters(pet: PetProfile, preference: HomeCompanionPreference): StudioCharacter[] {
  const sprite = getHomeCompanionSpriteOverride(preference) || getCompanionSprite(pet)
  const current: StudioCharacter = { id: sprite || `current:${pet.builtin_avatar_id || pet.pixel_avatar_url || pet.id}`, name: pet.name, pet, sprite, current: true }
  const candidates = (pet.selection_candidates || []).filter((candidate: PetAppearanceCandidate) => candidate.builtin_avatar_id && candidate.builtin_avatar_id !== pet.builtin_avatar_id)
  return [current, ...candidates.map(candidate => ({ id: candidate.id, name: candidate.name, pet: candidate, sprite: getCompanionSprite(candidate), current: false }))]
}
export function availableStudioActions(character?: StudioCharacter): StudioAction[] {
  if (!character) return []
  if (character.sprite) return ['idle', 'walk']
  const pet = character.pet
  return pet.builtin_avatar_id === 'jianwen-01' || (pet.pixel_avatar_squash_url && pet.pixel_avatar_jump_url) ? ['idle', 'hop'] : ['idle']
}
export function canTryStudioScarf(character?: StudioCharacter): boolean {
  return Boolean(character?.sprite && character.sprite.includes('companion-fbd87f73'))
}
function dressingKey(character: StudioCharacter): string | undefined {
  const user = String(Taro.getStorageSync('user_id') || '').trim()
  return user ? `${PET_STUDIO_DRESSING_KEY}:${user}:${encodeURIComponent(character.id)}` : undefined
}
export function readStudioScarf(character: StudioCharacter): boolean {
  try { const key = dressingKey(character); return Boolean(key && canTryStudioScarf(character) && Taro.getStorageSync(key) === 'scarf') } catch { return false }
}
export function saveStudioScarf(character: StudioCharacter, scarf: boolean): boolean {
  try {
    const key = dressingKey(character)
    if (!key || (scarf && !canTryStudioScarf(character))) return false
    Taro.setStorageSync(key, scarf ? 'scarf' : 'original')
    return true
  } catch { return false }
}
export function rhythmPoints(position: number): number {
  const error = Math.abs(position - 50)
  return error <= 8 ? 10 : error <= 18 ? 5 : 0
}
