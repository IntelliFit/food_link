import { View, Image } from '@tarojs/components'
import { useEffect, useMemo, useState } from 'react'
import { derivePetAppearance, type PetAnimal, type PetAppearanceCandidate, type PetProfile } from '@food-link/core'
import './PetAvatar.scss'

type PetVisual = Pick<PetProfile | PetAppearanceCandidate, 'pet_seed' | 'name' | 'color' | 'shape' | 'pattern' | 'accessory' | 'personality'>
  & Pick<Partial<PetProfile>, 'avatar_type' | 'pixel_avatar_url' | 'pixel_avatar_blink_url' | 'pixel_avatar_squash_url' | 'pixel_avatar_jump_url' | 'builtin_avatar_id'>

type PetMotion = 'static' | 'companion'
type PetMotionFrame = 'idle' | 'squash' | 'jump'

interface PetAvatarProps {
  pet?: Partial<PetVisual> | null
  animal?: PetAnimal
  size?: 'small' | 'medium' | 'large' | number
  mood?: string
  state?: string
  mealState?: string
  motion?: PetMotion
  className?: string
}

const BUILTIN_AVATAR_FRAMES: Record<string, {
  idle: string
  blink?: string
  squash?: string
  jump?: string
}> = {
  'jianwen-01': {
    idle: '/assets/pets/jianwen-01-idle.png',
    blink: '/assets/pets/jianwen-01-blink.png',
    squash: '/assets/pets/jianwen-01-squash.png',
    jump: '/assets/pets/jianwen-01-jump.png',
  },
  'huatuo-01': {
    idle: '/assets/pets/huatuo-01.png',
  },
  'taiji-xiaozi-01': {
    idle: '/assets/pets/taiji-xiaozi-01.png',
  },
}

const PET_PALETTE: Record<string, { body: string; accent: string; line: string; cheek: string }> = {
  mint: { body: '#bbf7d0', accent: '#5ee3a7', line: '#1f8a64', cheek: '#fb7185' },
  berry: { body: '#fecdd3', accent: '#fb7185', line: '#be3455', cheek: '#fda4af' },
  sunny: { body: '#fde68a', accent: '#f8b84e', line: '#a16207', cheek: '#fb923c' },
  aqua: { body: '#bfdbfe', accent: '#60a5fa', line: '#2563eb', cheek: '#93c5fd' },
  grape: { body: '#ddd6fe', accent: '#a78bfa', line: '#6d28d9', cheek: '#c4b5fd' },
  peach: { body: '#fed7aa', accent: '#fb923c', line: '#c2410c', cheek: '#fdba74' },
  cream: { body: '#fef3c7', accent: '#facc15', line: '#a16207', cheek: '#fcd34d' },
  matcha: { body: '#d9f99d', accent: '#84cc16', line: '#4d7c0f', cheek: '#bef264' },
}

/** 简易 base64 编码（小程序无 btoa） */
function toBase64(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  let i = 0
  while (i < str.length) {
    const a = str.charCodeAt(i++)
    const b = i < str.length ? str.charCodeAt(i++) : NaN
    const c = i < str.length ? str.charCodeAt(i++) : NaN
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c)
    out += chars.charAt((bitmap >> 18) & 63)
    out += chars.charAt((bitmap >> 12) & 63)
    out += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63)
    out += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63)
  }
  return out
}

interface SvgParts {
  appearance: ReturnType<typeof derivePetAppearance>
  palette: (typeof PET_PALETTE)['mint']
  dimmed: boolean
  mood?: string
  state?: string
  mealState?: string
}

function buildSvg({ appearance, palette, dimmed, mood, state, mealState }: SvgParts): string {
  const bodyTransform = mealState === 'hungry'
    ? 'translate(5 8) scale(.92 .88)'
    : mealState === 'satisfied'
      ? 'translate(-3 -2) scale(1.06 1.06)'
      : mealState === 'fed'
        ? 'translate(-2 -1) scale(1.04 1.03)'
        : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 120 120">
  <ellipse cx="60" cy="101" rx="34" ry="9" fill="rgba(15, 23, 42, 0.12)" />
  <g opacity="${dimmed ? 0.78 : 1}" transform="${bodyTransform}">
    ${renderTail(appearance.animal, palette.body, palette.line)}
    ${renderEars(appearance.animal, palette.body, palette.accent, palette.line)}
    ${renderBody(appearance.shape, palette.body, palette.line)}
    ${renderPattern(appearance.pattern, palette.accent, palette.line)}
    ${renderAccessory(appearance.accessory, palette.accent, palette.line)}
    ${renderFace(appearance.animal, mood, mealState, palette.cheek, palette.line)}
  </g>
  ${renderMoodGlow(mood, state)}
</svg>`
}

function renderBody(shape: string | undefined, color: string, line: string): string {
  if (shape === 'bean') {
    return `<path d="M36 37 C54 21 84 30 91 53 C100 82 75 101 48 91 C25 83 18 54 36 37 Z" fill="${color}" stroke="${line}" stroke-width="3.2" stroke-linecap="round" />`
  }
  if (shape === 'puff') {
    return `<g>
  <circle cx="46" cy="59" r="28" fill="${color}" stroke="${line}" stroke-width="3.2" />
  <circle cx="72" cy="60" r="31" fill="${color}" stroke="${line}" stroke-width="3.2" />
  <ellipse cx="60" cy="71" rx="39" ry="31" fill="${color}" stroke="${line}" stroke-width="3.2" />
</g>`
  }
  if (shape === 'drop') {
    return `<path d="M61 24 C84 43 97 62 91 79 C85 98 59 101 43 90 C23 75 30 47 61 24 Z" fill="${color}" stroke="${line}" stroke-width="3.2" stroke-linecap="round" />`
  }
  return `<circle cx="60" cy="62" r="36" fill="${color}" stroke="${line}" stroke-width="3.2" />`
}

function renderTail(animal: PetAnimal, color: string, line: string): string {
  if (animal === 'fox') {
    return `<path d="M88 67 C108 57 113 82 92 87 C99 79 98 72 88 67 Z" fill="${color}" stroke="${line}" stroke-width="3" />`
  }
  if (animal === 'cat') {
    return `<path d="M87 75 C107 76 104 49 91 54" fill="none" stroke="${line}" stroke-width="7" stroke-linecap="round" />`
  }
  if (animal === 'bunny') {
    return `<circle cx="90" cy="83" r="10" fill="${color}" stroke="${line}" stroke-width="3" />`
  }
  return `<path d="M88 76 C102 72 105 88 91 91" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round" />`
}

function renderEars(animal: PetAnimal, color: string, accent: string, line: string): string {
  if (animal === 'bunny') {
    return `<g>
  <ellipse cx="45" cy="29" rx="10" ry="24" fill="${color}" stroke="${line}" stroke-width="3" transform="rotate(-13 45 29)" />
  <ellipse cx="74" cy="29" rx="10" ry="24" fill="${color}" stroke="${line}" stroke-width="3" transform="rotate(13 74 29)" />
  <ellipse cx="45" cy="30" rx="4" ry="15" fill="${accent}" opacity="0.5" transform="rotate(-13 45 30)" />
  <ellipse cx="74" cy="30" rx="4" ry="15" fill="${accent}" opacity="0.5" transform="rotate(13 74 30)" />
</g>`
  }
  if (animal === 'bear' || animal === 'hamster') {
    return `<g>
  <circle cx="38" cy="37" r="${animal === 'bear' ? '13' : '10'}" fill="${color}" stroke="${line}" stroke-width="3" />
  <circle cx="82" cy="37" r="${animal === 'bear' ? '13' : '10'}" fill="${color}" stroke="${line}" stroke-width="3" />
  <circle cx="38" cy="37" r="5" fill="${accent}" opacity="0.55" />
  <circle cx="82" cy="37" r="5" fill="${accent}" opacity="0.55" />
</g>`
  }
  const fox = animal === 'fox'
  return `<g>
  <path d="${fox ? 'M34 43 L43 18 L55 45 Z' : 'M35 44 L43 22 L55 45 Z'}" fill="${color}" stroke="${line}" stroke-width="3" stroke-linejoin="round" />
  <path d="${fox ? 'M66 45 L78 18 L88 43 Z' : 'M66 45 L77 22 L86 44 Z'}" fill="${color}" stroke="${line}" stroke-width="3" stroke-linejoin="round" />
  <path d="M42 35 L46 27 L50 37 Z" fill="${accent}" opacity="0.5" />
  <path d="M72 37 L77 27 L81 35 Z" fill="${accent}" opacity="0.5" />
</g>`
}

function renderPattern(pattern: string | undefined, color: string, line: string): string {
  if (pattern === 'pattern-1') {
    return `<g opacity="0.4">
  <circle cx="47" cy="50" r="5" fill="${color}" />
  <circle cx="76" cy="59" r="4" fill="${color}" />
  <circle cx="55" cy="82" r="4" fill="${color}" />
</g>`
  }
  if (pattern === 'pattern-2') {
    return `<ellipse cx="60" cy="72" rx="21" ry="14" fill="none" stroke="${color}" stroke-width="7" opacity="0.36" />`
  }
  if (pattern === 'pattern-3') {
    return `<path d="M36 66 C48 80 72 82 88 66 C86 88 70 97 53 93 C39 90 31 80 36 66 Z" fill="${color}" opacity="0.28" />`
  }
  if (pattern === 'pattern-4') {
    return `<g opacity="0.32" stroke="${line}" stroke-width="4" stroke-linecap="round">
  <path d="M45 39 L40 54" />
  <path d="M61 35 L58 52" />
  <path d="M77 40 L72 55" />
</g>`
  }
  return ''
}

function renderAccessory(accessory: string | undefined, color: string, line: string): string {
  if (accessory === 'sprout') {
    return `<g stroke="${line}" stroke-width="2.4" stroke-linecap="round">
  <path d="M60 30 C57 23 56 19 58 15" />
  <path d="M58 20 C49 17 46 12 45 8 C54 8 60 12 58 20 Z" fill="${color}" />
  <path d="M60 20 C68 15 75 15 79 18 C72 24 66 25 60 20 Z" fill="${color}" />
</g>`
  }
  if (accessory === 'scarf') {
    return `<g>
  <path d="M32 79 C47 87 72 88 89 78 L87 88 C69 97 49 96 34 88 Z" fill="${color}" stroke="${line}" stroke-width="2.5" />
  <path d="M74 86 L87 101 L76 101 L67 89 Z" fill="${color}" stroke="${line}" stroke-width="2.5" />
</g>`
  }
  if (accessory === 'drop') {
    return `<path d="M79 31 C86 40 89 46 85 52 C81 59 70 57 69 49 C68 43 73 37 79 31 Z" fill="#7dd3fc" stroke="${line}" stroke-width="2.4" />`
  }
  if (accessory === 'star') {
    return `<path d="M82 27 L86 36 L96 36 L88 42 L91 52 L82 46 L73 52 L76 42 L68 36 L78 36 Z" fill="#fde047" stroke="${line}" stroke-width="2.3" stroke-linejoin="round" />`
  }
  if (accessory === 'cap') {
    return `<g>
  <path d="M42 34 C52 23 72 23 82 34 L77 43 C65 38 54 38 45 43 Z" fill="${color}" stroke="${line}" stroke-width="2.5" />
  <path d="M76 40 C89 41 93 45 92 49 C85 49 79 47 74 43 Z" fill="${color}" stroke="${line}" stroke-width="2.5" />
</g>`
  }
  if (accessory === 'bow') {
    return `<g>
  <path d="M42 34 C31 26 28 45 42 44 Z" fill="${color}" stroke="${line}" stroke-width="2.4" />
  <path d="M51 34 C63 26 66 45 51 44 Z" fill="${color}" stroke="${line}" stroke-width="2.4" />
  <circle cx="47" cy="39" r="4" fill="${line}" />
</g>`
  }
  if (accessory === 'halo') {
    return `<ellipse cx="60" cy="21" rx="22" ry="7" fill="none" stroke="#facc15" stroke-width="4" opacity="0.78" />`
  }
  return `<path d="M38 31 C28 25 26 15 28 9 C40 12 46 21 38 31 Z" fill="${color}" stroke="${line}" stroke-width="2.4" />`
}

function renderFace(animal: PetAnimal, mood: string | undefined, mealState: string | undefined, cheek: string, line: string): string {
  const sleepy = mood === 'sleepy'
  const surprised = mood === 'surprised'
  const happy = mood === 'happy'
  const muzzle = animal === 'hamster' || animal === 'bear'
    ? `<ellipse cx="60" cy="68" rx="18" ry="12" fill="rgba(255,255,255,0.48)" />`
    : ''
  const eyes = sleepy
    ? `<g stroke="${line}" stroke-width="3" stroke-linecap="round">
  <path d="M45 58 C49 61 53 61 56 58" />
  <path d="M66 58 C70 61 74 61 77 58" />
</g>`
    : `<g fill="${line}">
  <circle cx="50" cy="58" r="${surprised ? '4.5' : '3.6'}" />
  <circle cx="70" cy="58" r="${surprised ? '4.5' : '3.6'}" />
  <circle cx="51.5" cy="56.5" r="1.2" fill="#fff" />
  <circle cx="71.5" cy="56.5" r="1.2" fill="#fff" />
</g>`
  const mouth = mealState === 'hungry'
    ? `<path d="M52 77 C56 71 65 71 69 77" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round" />`
    : surprised
    ? `<path d="M58 72 C58 68 63 68 63 72 C63 77 58 77 58 72 Z" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round" />`
    : happy
      ? `<path d="M52 72 C56 79 65 79 69 72" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round" />`
      : `<path d="M55 72 C58 75 62 75 65 72" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round" />`
  return `<g>
  ${muzzle}
  ${eyes}
  <ellipse cx="60" cy="68" rx="8" ry="5" fill="rgba(255,255,255,0.5)" />
  ${mouth}
  <circle cx="40" cy="68" r="5" fill="${cheek}" opacity="0.36" />
  <circle cx="80" cy="68" r="5" fill="${cheek}" opacity="0.36" />
</g>`
}

function renderMoodGlow(mood: string | undefined, state: string | undefined): string {
  if (state === 'warming') return `<circle cx="96" cy="25" r="6" fill="#f5bc5b" opacity="0.82" />`
  if (mood === 'happy') return `<circle cx="96" cy="25" r="6" fill="#5cb896" opacity="0.82" />`
  if (mood === 'surprised') return `<circle cx="96" cy="25" r="6" fill="#f5bc5b" opacity="0.82" />`
  if (mood === 'sleepy') return `<circle cx="96" cy="25" r="6" fill="#60a5fa" opacity="0.72" />`
  return ''
}

export function PetAvatar({ pet, animal, size = 'medium', mood, state, mealState, motion = 'static', className }: PetAvatarProps) {
  const appearance = derivePetAppearance(pet)
  if (animal) appearance.animal = animal
  const palette = PET_PALETTE[appearance.color] || PET_PALETTE.mint
  const dimmed = state === 'low_power' || state === 'hibernating' || state === 'deep_sleep'
  const label = `${pet?.name || '成长伙伴'}，${petMoodLabel(mood)}，${petStateLabel(state)}`
  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : undefined
  const sizeClass = typeof size === 'string' ? `pet-avatar--${size}` : ''
  const builtinFrames = BUILTIN_AVATAR_FRAMES[String(pet?.builtin_avatar_id || '').trim()]
  const customAvatarURL = builtinFrames?.idle || String(pet?.pixel_avatar_url || '').trim()
  const customAvatarBlinkURL = builtinFrames?.blink || String(pet?.pixel_avatar_blink_url || '').trim()
  const customAvatarSquashURL = builtinFrames?.squash || String(pet?.pixel_avatar_squash_url || '').trim()
  const customAvatarJumpURL = builtinFrames?.jump || String(pet?.pixel_avatar_jump_url || '').trim()
  const hasMotionFrames = Boolean(customAvatarSquashURL && customAvatarJumpURL)
  const isPixelatedAvatar = pet?.avatar_type === 'pixel_self'
    || String(pet?.builtin_avatar_id || '').trim() === 'jianwen-01'
  const [blinking, setBlinking] = useState(false)
  const [motionFrame, setMotionFrame] = useState<PetMotionFrame>('idle')

  useEffect(() => {
    if (customAvatarURL && !customAvatarBlinkURL) {
      setBlinking(false)
      return undefined
    }

    const pauses = [1600, 3200, 2400, 3900]
    let pauseIndex = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const scheduleBlink = (delay: number) => {
      timer = setTimeout(() => {
        if (disposed) return
        setBlinking(true)
        timer = setTimeout(() => {
          if (disposed) return
          setBlinking(false)
          const nextDelay = pauses[pauseIndex % pauses.length]
          pauseIndex += 1
          scheduleBlink(nextDelay)
        }, 170)
      }, delay)
    }

    scheduleBlink(900)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [customAvatarBlinkURL, customAvatarURL])

  useEffect(() => {
    if (motion !== 'companion') {
      setMotionFrame('idle')
      return undefined
    }

    const pauses = [4200, 5600, 4800, 6400]
    let pauseIndex = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const scheduleHop = (delay: number) => {
      timer = setTimeout(() => {
        if (disposed) return
        setMotionFrame('squash')
        timer = setTimeout(() => {
          if (disposed) return
          setMotionFrame('jump')
          timer = setTimeout(() => {
            if (disposed) return
            setMotionFrame('squash')
            timer = setTimeout(() => {
              if (disposed) return
              setMotionFrame('idle')
              const nextDelay = pauses[pauseIndex % pauses.length]
              pauseIndex += 1
              scheduleHop(nextDelay)
            }, 100)
          }, 420)
        }, 110)
      }, delay)
    }

    scheduleHop(1400)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [motion])

  const src = useMemo(() => {
    const svg = buildSvg({ appearance, palette, dimmed, mood, state, mealState })
    return `data:image/svg+xml;base64,${toBase64(svg)}`
  }, [
    appearance.seed,
    appearance.color,
    appearance.shape,
    appearance.animal,
    appearance.pattern,
    appearance.accessory,
    palette.body,
    palette.accent,
    palette.line,
    palette.cheek,
    dimmed,
    mood,
    state,
    mealState,
  ])

  const motionClass = motionFrame === 'jump'
    ? 'pet-avatar--motion-jump'
    : motionFrame === 'squash'
      ? 'pet-avatar--motion-squash'
      : ''

  return (
    <View
      className={`pet-avatar ${sizeClass} ${dimmed ? 'pet-avatar--dimmed' : ''} ${state === 'warming' ? 'pet-avatar--warming' : ''} ${customAvatarURL ? 'pet-avatar--custom' : ''} ${isPixelatedAvatar ? 'pet-avatar--pixelated' : ''} ${hasMotionFrames ? 'pet-avatar--has-motion-frames' : ''} ${blinking ? 'pet-avatar--blinking' : ''} ${motionClass} ${mealState ? `pet-avatar--meal-${mealState}` : ''} ${className || ''}`}
      style={sizeStyle}
      aria-label={label}
      role='img'
    >
      <View className='pet-avatar__body'>
        <Image
          className='pet-avatar__image pet-avatar__frame pet-avatar__frame--idle'
          src={customAvatarURL || src}
          mode='aspectFit'
          lazyLoad={false}
        />
        {customAvatarBlinkURL ? (
          <Image className='pet-avatar__frame pet-avatar__frame--blink' src={customAvatarBlinkURL} mode='aspectFit' lazyLoad={false} />
        ) : null}
        {customAvatarSquashURL ? (
          <Image className='pet-avatar__frame pet-avatar__frame--squash' src={customAvatarSquashURL} mode='aspectFit' lazyLoad={false} />
        ) : null}
        {customAvatarJumpURL ? (
          <Image className='pet-avatar__frame pet-avatar__frame--jump' src={customAvatarJumpURL} mode='aspectFit' lazyLoad={false} />
        ) : null}
        {!customAvatarURL ? (
          <View className='pet-avatar__blink-overlay'>
            <View className='pet-avatar__blink-eye is-left' style={{ backgroundColor: palette.body }} />
            <View className='pet-avatar__blink-eye is-right' style={{ backgroundColor: palette.body }} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function petMoodLabel(mood?: string): string {
  const labels: Record<string, string> = {
    happy: '状态：开心',
    focused: '状态：专注',
    sleepy: '状态：犯困',
    surprised: '状态：惊喜',
    calm: '状态：平稳',
  }
  return labels[mood || ''] || (mood ? `状态：${mood}` : '状态：平稳')
}

export function petStateLabel(state?: string): string {
  const labels: Record<string, string> = {
    active: '活跃',
    warming: '唤醒中',
    dozing: '小憩',
    low_power: '能量偏低',
    hibernating: '休眠',
    deep_sleep: '深度休息',
    happy: '开心',
    focused: '专注',
    sleepy: '犯困',
    surprised: '惊喜',
    calm: '平稳',
  }
  return labels[state || ''] || '活跃'
}

export function petShapeLabel(shape?: string): string {
  const labels: Record<string, string> = {
    round: '圆团',
    bean: '豆豆',
    puff: '蓬松',
    drop: '水滴',
  }
  return labels[shape || ''] || (shape || '基础')
}

export function petPatternLabel(pattern?: string): string {
  const labels: Record<string, string> = {
    'pattern-0': '纯色',
    'pattern-1': '小斑点',
    'pattern-2': '软圆纹',
    'pattern-3': '肚肚纹',
    'pattern-4': '竖条纹',
  }
  return labels[pattern || ''] || (pattern || '纯色')
}

export function petAccessoryLabel(accessory?: string): string {
  const labels: Record<string, string> = {
    leaf: '叶片',
    sprout: '嫩芽',
    scarf: '围巾',
    drop: '水滴',
    star: '星星',
    cap: '帽子',
    bow: '蝴蝶结',
    halo: '光环',
  }
  return labels[accessory || ''] || (accessory || '无配饰')
}

export function petPersonalityLabel(personality?: string): string {
  const labels: Record<string, string> = {
    gentle: '温和',
    energetic: '活力',
    focused: '专注',
    snacky: '爱尝鲜',
    sporty: '运动型',
  }
  return labels[personality || ''] || (personality || '均衡')
}
