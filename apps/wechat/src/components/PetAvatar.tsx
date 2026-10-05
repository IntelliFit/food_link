import { View, Image } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { type PetAnimal, type PetAppearanceCandidate, type PetProfile } from '@food-link/core'
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
  'xiaomai-01': {
    idle: '/assets/pets/xiaomai-01.png',
  },
  'doudou-01': {
    idle: '/assets/pets/doudou-01.png',
  },
}

function hasBuiltinAvatar(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_AVATAR_FRAMES, id)
}

export function PetAvatar({ pet, animal, size = 'medium', mood, state, mealState, motion = 'static', className }: PetAvatarProps) {
  const dimmed = state === 'low_power' || state === 'hibernating' || state === 'deep_sleep'
  const label = `${pet?.name || '成长伙伴'}，${petMoodLabel(mood)}，${petStateLabel(state)}`
  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : undefined
  const sizeClass = typeof size === 'string' ? `pet-avatar--${size}` : ''
  const requestedBuiltinID = String(pet?.builtin_avatar_id || '').trim()
  const seedBuiltinID = String(pet?.pet_seed || '').trim().replace(/^builtin:/, '')
  const pixelURL = String(pet?.pixel_avatar_url || '').trim()
  const useCustomAvatar = Boolean(pixelURL) && (pet?.avatar_type === 'pixel_self' || !hasBuiltinAvatar(requestedBuiltinID))
  // Older servers/archives may still omit image metadata. Display the same
  // established default as the server upgrade instead of reviving retired SVGs.
  const builtinID = hasBuiltinAvatar(requestedBuiltinID) ? requestedBuiltinID
    : hasBuiltinAvatar(seedBuiltinID) ? seedBuiltinID : 'jianwen-01'
  const builtinFrames = useCustomAvatar ? undefined : BUILTIN_AVATAR_FRAMES[builtinID]
  const customAvatarURL = builtinFrames?.idle || pixelURL
  const customAvatarBlinkURL = builtinFrames?.blink || (useCustomAvatar ? String(pet?.pixel_avatar_blink_url || '').trim() : '')
  const customAvatarSquashURL = builtinFrames?.squash || (useCustomAvatar ? String(pet?.pixel_avatar_squash_url || '').trim() : '')
  const customAvatarJumpURL = builtinFrames?.jump || (useCustomAvatar ? String(pet?.pixel_avatar_jump_url || '').trim() : '')
  const hasMotionFrames = Boolean(customAvatarSquashURL && customAvatarJumpURL)
  const isPixelatedAvatar = useCustomAvatar || builtinID === 'jianwen-01'
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

  const motionClass = motionFrame === 'jump'
    ? 'pet-avatar--motion-jump'
    : motionFrame === 'squash'
      ? 'pet-avatar--motion-squash'
      : ''

  // 请求当前宠物期间保持空白，避免先渲染旧版程序化默认形象，
  // 再在接口返回后闪切为用户实际选择的内置角色。
  if (!pet && !animal) return null

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
          src={customAvatarURL}
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
