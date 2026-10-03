import Taro from '@tarojs/taro'
import type { PetTransportId } from './pet-transport'
import { petTransportAppearance, petTransportCapabilities } from './pet-transport'
import type { PetProfile } from './api'

export const PET_TRANSPORT_CHANGED = 'pet_transport_changed_v1'
export interface PetTransportChoice { version: 1; appearance: string; vehicle: PetTransportId }
const vehicles: PetTransportId[] = ['walk', 'bicycle', 'scooter', 'skateboard']
const account = () => String(Taro.getStorageSync('user_id') || '').trim()
export const petTransportStorageKey = (user: string, petId: string, appearance: string) => `pet_transport_v1:${user}:${petId}:${encodeURIComponent(appearance)}`
export function readPetTransport(petId: string, appearance: string, fallback: PetTransportId): PetTransportChoice | null {
  try {
    const user = account()
    if (!user || !petId || !appearance) return null
    const stored = Taro.getStorageSync(petTransportStorageKey(user, petId, appearance))
    return { version: 1, appearance, vehicle: stored?.version === 1 && stored.appearance === appearance && vehicles.includes(stored.vehicle) ? stored.vehicle : fallback }
  } catch { return null }
}
export function savePetTransport(pet: Partial<PetProfile>, sprite: string | undefined, vehicle: PetTransportId, expectedAccount: string): boolean {
  try {
    const appearance = petTransportAppearance(pet, sprite)
    if (!expectedAccount || account() !== expectedAccount || !pet.id || !appearance || !vehicles.includes(vehicle) || !petTransportCapabilities(pet, sprite).includes(vehicle)) return false
    // Independent record: choosing transport never rewrites clothing, growth or the wallet.
    Taro.setStorageSync(petTransportStorageKey(expectedAccount, pet.id, appearance), { version: 1, appearance, vehicle })
    try { Taro.eventCenter.trigger(PET_TRANSPORT_CHANGED) } catch { /* The committed choice survives subscriber errors. */ }
    return true
  } catch { return false }
}
