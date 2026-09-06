import { useEffect, useMemo, useState } from 'react'
import { AccessibilityInfo, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native'
import { SvgXml } from 'react-native-svg'
import type { PetAppearanceCandidate, PetProfile } from '@food-link/core'
import { colors } from '../theme'

type PetVisual = Pick<PetProfile | PetAppearanceCandidate, 'pet_seed' | 'name' | 'color' | 'shape' | 'pattern' | 'accessory' | 'personality'>
  & Pick<Partial<PetProfile>, 'avatar_type' | 'pixel_avatar_url' | 'pixel_avatar_blink_url' | 'pixel_avatar_squash_url' | 'pixel_avatar_jump_url' | 'builtin_avatar_id'>

type PetMotion = 'static' | 'companion'
type PetMotionFrame = 'idle' | 'squash' | 'jump'

interface PetAvatarProps {
  pet?: Partial<PetVisual> | null
  size?: 'small' | 'medium' | 'large' | number
  mood?: string
  state?: string
  mealState?: string
  motion?: PetMotion
}

interface PetAvatarFrames {
  idle: ImageSourcePropType
  blink?: ImageSourcePropType
  squash?: ImageSourcePropType
  jump?: ImageSourcePropType
}

const BUILTIN_AVATAR_FRAMES: Record<string, PetAvatarFrames> = {
  'jianwen-01': {
    idle: require('../../assets/pets/jianwen-01-idle.png'),
    blink: require('../../assets/pets/jianwen-01-blink.png'),
    squash: require('../../assets/pets/jianwen-01-squash.png'),
    jump: require('../../assets/pets/jianwen-01-jump.png'),
  },
  'huatuo-01': { idle: require('../../assets/pets/huatuo-01.png') },
  'taiji-xiaozi-01': { idle: require('../../assets/pets/taiji-xiaozi-01.png') },
  'xiaomai-01': { idle: require('../../assets/pets/xiaomai-01.png') },
  'doudou-01': { idle: require('../../assets/pets/doudou-01.png') },
}


export function isSupportedBuiltinPetAvatar(id?: string): boolean {
  return Boolean(BUILTIN_AVATAR_FRAMES[String(id || '').trim()])
}
const FALLBACK_AVATAR = BUILTIN_AVATAR_FRAMES['jianwen-01']
const GUEST_PET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <ellipse cx="60" cy="101" rx="34" ry="9" fill="rgba(15, 23, 42, 0.12)" />
  <g>
    <path d="M88 67 C108 57 113 82 92 87 C99 79 98 72 88 67 Z" fill="#fecdd3" stroke="#be3455" stroke-width="3" />
    <path d="M34 43 L43 18 L55 45 Z" fill="#fecdd3" stroke="#be3455" stroke-width="3" stroke-linejoin="round" />
    <path d="M66 45 L78 18 L88 43 Z" fill="#fecdd3" stroke="#be3455" stroke-width="3" stroke-linejoin="round" />
    <path d="M42 35 L46 27 L50 37 Z" fill="#fb7185" opacity="0.5" /><path d="M72 37 L77 27 L81 35 Z" fill="#fb7185" opacity="0.5" />
    <path d="M61 24 C84 43 97 62 91 79 C85 98 59 101 43 90 C23 75 30 47 61 24 Z" fill="#fecdd3" stroke="#be3455" stroke-width="3.2" stroke-linecap="round" />
    <g opacity="0.32" stroke="#be3455" stroke-width="4" stroke-linecap="round"><path d="M45 39 L40 54" /><path d="M61 35 L58 52" /><path d="M77 40 L72 55" /></g>
    <path d="M38 31 C28 25 26 15 28 9 C40 12 46 21 38 31 Z" fill="#fb7185" stroke="#be3455" stroke-width="2.4" />
    <g fill="#be3455"><circle cx="50" cy="58" r="3.6" /><circle cx="70" cy="58" r="3.6" /><circle cx="51.5" cy="56.5" r="1.2" fill="#fff" /><circle cx="71.5" cy="56.5" r="1.2" fill="#fff" /></g>
    <ellipse cx="60" cy="68" rx="8" ry="5" fill="rgba(255,255,255,0.5)" /><path d="M55 72 C58 75 62 75 65 72" fill="none" stroke="#be3455" stroke-width="2.6" stroke-linecap="round" />
    <circle cx="40" cy="68" r="5" fill="#fda4af" opacity="0.36" /><circle cx="80" cy="68" r="5" fill="#fda4af" opacity="0.36" />
  </g>
</svg>`

function remoteSource(url?: string): ImageSourcePropType | undefined {
  const uri = String(url || '').trim()
  return uri ? { uri } : undefined
}

function resolveAvatarFrames(pet: Partial<PetVisual>): PetAvatarFrames {
  const builtin = BUILTIN_AVATAR_FRAMES[String(pet.builtin_avatar_id || '').trim()]
  if (builtin) return builtin
  const idle = remoteSource(pet.pixel_avatar_url)
  if (idle) {
    return {
      idle,
      blink: remoteSource(pet.pixel_avatar_blink_url),
      squash: remoteSource(pet.pixel_avatar_squash_url),
      jump: remoteSource(pet.pixel_avatar_jump_url),
    }
  }
  // 兼容旧账号，但不再显示历史猫、兔、熊等程序化动物。
  return FALLBACK_AVATAR
}

export function PetAvatar({ pet, size = 'medium', mood, state, mealState, motion = 'static' }: PetAvatarProps) {
  const frames = useMemo(() => pet ? resolveAvatarFrames(pet) : FALLBACK_AVATAR, [
    pet?.avatar_type,
    pet?.builtin_avatar_id,
    pet?.pixel_avatar_url,
    pet?.pixel_avatar_blink_url,
    pet?.pixel_avatar_squash_url,
    pet?.pixel_avatar_jump_url,
  ])
  const [blinking, setBlinking] = useState(false)
  const [motionFrame, setMotionFrame] = useState<PetMotionFrame>('idle')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => setImageFailed(false), [frames.idle])

  useEffect(() => {
    if (reduceMotion || !frames.blink) {
      setBlinking(false)
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const blink = () => {
      timer = setTimeout(() => {
        if (stopped) return
        setBlinking(true)
        timer = setTimeout(() => {
          setBlinking(false)
          if (!stopped) blink()
        }, 170)
      }, 2800)
    }
    blink()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [frames.blink, reduceMotion])

  useEffect(() => {
    if (reduceMotion || motion !== 'companion' || !frames.squash || !frames.jump) {
      setMotionFrame('idle')
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const hop = () => {
      timer = setTimeout(() => {
        if (stopped) return
        setMotionFrame('squash')
        timer = setTimeout(() => {
          setMotionFrame('jump')
          timer = setTimeout(() => {
            setMotionFrame('idle')
            if (!stopped) hop()
          }, 430)
        }, 120)
      }, 5200)
    }
    hop()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [frames.jump, frames.squash, motion, reduceMotion])

  if (!pet) {
    return (
      <View
        accessibilityLabel="成长伙伴，状态：平稳，活跃"
        accessibilityRole="image"
        style={[styles.avatar, typeof size === 'number' ? { width: size, height: size } : styles[size]]}
      >
        <SvgXml xml={GUEST_PET_SVG} width="100%" height="100%" />
      </View>
    )
  }

  const dimmed = ['low_power', 'hibernating', 'deep_sleep'].includes(state || '')
  const activeSource = imageFailed
    ? FALLBACK_AVATAR.idle
    : motionFrame === 'jump' && frames.jump
      ? frames.jump
      : motionFrame === 'squash' && frames.squash
        ? frames.squash
        : blinking && frames.blink
          ? frames.blink
          : frames.idle

  return (
    <View
      accessibilityLabel={`${pet.name || '成长伙伴'}，${petMoodLabel(mood)}，${petStateLabel(state)}`}
      accessibilityRole="image"
      style={[
        styles.avatar,
        typeof size === 'number' ? { width: size, height: size } : styles[size],
        dimmed && styles.stateMuted,
        state === 'warming' && styles.stateWarming,
        mealState === 'hungry' && styles.mealHungry,
        (mealState === 'fed' || mealState === 'satisfied') && styles.mealFed,
        motionFrame === 'jump' && !reduceMotion && styles.motionJump,
        motionFrame === 'squash' && !reduceMotion && styles.motionSquash,
      ]}
    >
      <Image source={activeSource} style={styles.image} resizeMode="contain" fadeDuration={0} onError={() => setImageFailed(true)} />
    </View>
  )
}

export function petMoodLabel(mood?: string): string {
  const labels: Record<string, string> = { happy: '状态：开心', focused: '状态：专注', sleepy: '状态：犯困', surprised: '状态：惊喜', calm: '状态：平稳' }
  return labels[mood || ''] || (mood ? `状态：${mood}` : '状态：平稳')
}

export function petStateLabel(state?: string): string {
  const labels: Record<string, string> = { active: '活跃', warming: '唤醒中', dozing: '小憩', low_power: '能量偏低', hibernating: '休眠', deep_sleep: '深度休息', happy: '开心', focused: '专注', sleepy: '犯困', surprised: '惊喜', calm: '平稳' }
  return labels[state || ''] || '活跃'
}

// 仅供未挂路由的内部实验页，正式宠物入口不再展示旧式换装。
export function petShapeLabel(shape?: string): string {
  return ({ round: '圆团', bean: '豆豆', puff: '蓬松', drop: '水滴' } as Record<string, string>)[shape || ''] || shape || '基础'
}

export function petPatternLabel(pattern?: string): string {
  return ({ 'pattern-0': '纯色', 'pattern-1': '小斑点', 'pattern-2': '软圆纹', 'pattern-3': '肚肚纹', 'pattern-4': '竖条纹' } as Record<string, string>)[pattern || ''] || pattern || '纯色'
}

export function petAccessoryLabel(accessory?: string): string {
  return ({ leaf: '叶片', sprout: '嫩芽', scarf: '围巾', drop: '水滴', star: '星星', cap: '帽子', bow: '蝴蝶结', halo: '光环' } as Record<string, string>)[accessory || ''] || accessory || '无配饰'
}

export function petPersonalityLabel(personality?: string): string {
  return ({ gentle: '温和', energetic: '活力', focused: '专注', snacky: '爱尝鲜', sporty: '运动型' } as Record<string, string>)[personality || ''] || personality || '均衡'
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  small: { width: 54, height: 54 },
  medium: { width: 82, height: 82 },
  large: { width: 132, height: 132 },
  stateMuted: { opacity: 0.72 },
  stateWarming: {
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 3,
  },
  mealHungry: { transform: [{ scaleX: 0.94 }, { scaleY: 0.9 }] },
  mealFed: { transform: [{ scale: 1.04 }] },
  motionJump: { transform: [{ translateY: -6 }] },
  motionSquash: { transform: [{ scaleX: 1.04 }, { scaleY: 0.94 }] },
})
