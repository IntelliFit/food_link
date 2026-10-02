import Taro from '@tarojs/taro'
import { ORIGINAL_COMPANION_SRC } from './pet-companion-preference'

export const PET_LOADOUT_CHANGED = 'pet_loadout_changed_v2'
export interface PetLoadout { version: 2; appearance: string; scarf: 'cozy-scarf' | 'explorer-scarf' | null }
const account = () => String(Taro.getStorageSync('user_id') || '').trim()
const key = (user: string, petId: string, appearance: string) => `pet_loadout_v2:${user}:${petId}:${encodeURIComponent(appearance)}`
export function readPetLoadout(petId: string, appearance: string): PetLoadout | null {
  try {
    const user = account()
    if (!user || !petId) return null
    const stored = Taro.getStorageSync(key(user, petId, appearance))
    if (stored?.version === 2 && stored.appearance === appearance) return { version: 2, appearance, scarf: appearance === ORIGINAL_COMPANION_SRC && ['cozy-scarf', 'explorer-scarf'].includes(stored.scarf) ? stored.scarf : null }
    // Read old outfits without writing: failed/partial migration must not erase user progress.
    const legacy = Taro.getStorageSync(`pet_adventure_progress_v1:${user}:${petId}`)
    // v1 trial was an account+appearance preference shared by same-looking pets; keep that original scope.
    // An explicit v2 confirmation binds an independent choice to this pet and appearance.
    const trial = Taro.getStorageSync(`pet_studio_dressing_v1:${user}:${encodeURIComponent(appearance)}`)
    return { version: 2, appearance, scarf: appearance !== ORIGINAL_COMPANION_SRC ? null : legacy?.equipment?.scarf === 'explorer-scarf' ? 'explorer-scarf' : trial === 'scarf' ? 'cozy-scarf' : null }
  } catch { return null }
}
export function savePetLoadout(petId: string, appearance: string, scarf: PetLoadout['scarf'], expectedAccount: string): boolean {
  try {
    if (!expectedAccount || account() !== expectedAccount || !petId || (scarf && appearance !== ORIGINAL_COMPANION_SRC)) return false
    Taro.setStorageSync(key(expectedAccount, petId, appearance), { version: 2, appearance, scarf })
    try { Taro.eventCenter.trigger(PET_LOADOUT_CHANGED) } catch { /* A view listener cannot undo the committed outfit. */ }
    return true
  } catch { return false }
}
