import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { getPetSummary, type PetProfile } from '../utils/api'
import { currentRecapOwner } from '../utils/recap-archive'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../utils/pet-events'
import { PetActor, type PetAction } from './PetActor'

/** Small report scenes use the same account identity and appearance as home/chat. */
export function CurrentPetCompanion({ action = 'idle', active = true }: { action?: PetAction; active?: boolean }) {
  const owner = currentRecapOwner()
  const [profile, setProfile] = useState<{ owner: string; pet: PetProfile } | null>(null)
  useEffect(() => {
    if (!owner || !active) return
    let disposed = false
    let sequence = 0
    const load = async () => {
      const request = ++sequence
      try {
        const result = await getPetSummary()
        if (!disposed && request === sequence && currentRecapOwner() === owner) setProfile(result.pet?.id ? { owner, pet: result.pet } : null)
      } catch { /* A missing profile stays blank; never substitute another character. */ }
    }
    void load()
    Taro.eventCenter.on(HOME_PET_PROFILE_CHANGED_EVENT, load)
    return () => { disposed = true; Taro.eventCenter.off(HOME_PET_PROFILE_CHANGED_EVENT, load) }
  }, [owner, active])
  if (!profile || profile.owner !== owner) return null
  const size = 156 * (Taro.getSystemInfoSync().windowWidth || 375) / 750
  return <View style={{ width: '120rpx', height: '156rpx', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PetActor pet={profile.pet} size={size} action={action} active={active} /></View>
}
