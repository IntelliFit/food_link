import { Image, View } from '@tarojs/components'
import type { PetProfile } from '@food-link/core'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from '../utils/pet-companion-preference'
import './PetCompanionSprite.scss'

type CompanionAppearance = Pick<PetProfile, 'builtin_avatar_id' | 'pixel_avatar_url'>

// Match the selected appearance, not the account, so switching pets keeps its identity.
// Ignore CDN host/signature changes; no private avatar URL is bundled into the app.
export function getCompanionSprite(pet?: Partial<CompanionAppearance>): string | undefined {
  if (pet?.builtin_avatar_id?.trim() === 'jianwen-01') return JIANWEN_COMPANION_SRC
  if (pet?.builtin_avatar_id?.trim() || !pet?.pixel_avatar_url) return undefined
  const resourcePath = pet.pixel_avatar_url.trim().split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/i, '')
  let fingerprint = 2166136261
  for (let index = 0; index < resourcePath.length; index += 1) {
    fingerprint = Math.imul(fingerprint ^ resourcePath.charCodeAt(index), 16777619)
  }
  return (fingerprint >>> 0).toString(16) === 'fbd87f73'
    ? ORIGINAL_COMPANION_SRC
    : undefined
}

export function PetCompanionSprite({ src, name, pose = 'idle' }: { src: string; name?: string; pose?: 'idle' | 'blink' | 'wave' | 'kick' }) {
  const jianwen = src === JIANWEN_COMPANION_SRC
  return (
    <View className={`pet-companion-sprite ${jianwen ? 'pet-companion-sprite--jianwen' : 'pet-companion-sprite--original'} is-${pose}`} role='img' aria-label={`${name || '宠物'}的完整形象`}>
      <Image className='pet-companion-sprite__sheet' src={src} mode='scaleToFill' lazyLoad={false} />
    </View>
  )
}
