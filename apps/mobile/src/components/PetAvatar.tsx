import { StyleSheet, Text, View } from 'react-native'
import type { PetAppearanceCandidate, PetProfile } from '@food-link/core'
import { colors } from '../theme'

type PetVisual = Pick<PetProfile | PetAppearanceCandidate, 'name' | 'color' | 'shape' | 'pattern' | 'accessory' | 'personality'>

interface PetAvatarProps {
  pet?: Partial<PetVisual> | null
  size?: 'small' | 'medium' | 'large'
  mood?: string
  state?: string
}

export function PetAvatar({ pet, size = 'medium', mood, state }: PetAvatarProps) {
  const initial = (pet?.name || '食').slice(0, 1)
  const accessory = petAccessoryShortLabel(pet?.accessory)
  return (
    <View style={[styles.avatar, styles[size], petColorStyle(pet?.color), petShapeStyle(pet?.shape), petStateStyle(state)]}>
      <View style={[styles.pattern, petPatternStyle(pet?.pattern)]} />
      <Text style={[styles.initial, styles[`${size}Initial`]]}>{initial}</Text>
      {accessory ? (
        <View style={[styles.accessory, styles[`${size}Accessory`]]}>
          <Text style={styles.accessoryText}>{accessory}</Text>
        </View>
      ) : null}
      {mood ? <View style={[styles.moodDot, petMoodStyle(mood)]} /> : null}
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
    round: '圆润',
    bean: '豆形',
    puff: '蓬松',
    drop: '水滴',
  }
  return labels[shape || ''] || (shape || '基础')
}

export function petPatternLabel(pattern?: string): string {
  const labels: Record<string, string> = {
    'pattern-0': '纯色',
    'pattern-1': '浅纹',
    'pattern-2': '环纹',
    'pattern-3': '点纹',
    'pattern-4': '高光',
  }
  return labels[pattern || ''] || (pattern || '纯色')
}

export function petAccessoryLabel(accessory?: string): string {
  const labels: Record<string, string> = {
    leaf: '叶片',
    sprout: '嫩芽',
    scarf: '围巾',
    drop: '水滴',
    star: '星标',
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

export function petColorStyle(color?: string) {
  const palette: Record<string, string> = {
    mint: '#bbf7d0',
    berry: '#fecdd3',
    sunny: '#fde68a',
    aqua: '#bfdbfe',
    grape: '#ddd6fe',
    peach: '#fed7aa',
    cream: '#fef3c7',
    matcha: '#d9f99d',
  }
  return { backgroundColor: palette[color || 'mint'] || colors.brandSoft }
}

function petShapeStyle(shape?: string) {
  if (shape === 'bean') return styles.shapeBean
  if (shape === 'puff') return styles.shapePuff
  if (shape === 'drop') return styles.shapeDrop
  return styles.shapeRound
}

function petPatternStyle(pattern?: string) {
  if (pattern === 'pattern-1') return styles.patternStripe
  if (pattern === 'pattern-2') return styles.patternRing
  if (pattern === 'pattern-3') return styles.patternDot
  if (pattern === 'pattern-4') return styles.patternGlow
  return styles.patternPlain
}

function petMoodStyle(mood?: string) {
  if (mood === 'happy') return styles.moodHappy
  if (mood === 'sleepy') return styles.moodSleepy
  if (mood === 'surprised') return styles.moodSurprised
  return styles.moodCalm
}

function petStateStyle(state?: string) {
  if (state === 'low_power' || state === 'hibernating' || state === 'deep_sleep') return styles.stateMuted
  if (state === 'warming') return styles.stateWarming
  return null
}

function petAccessoryShortLabel(accessory?: string): string {
  const labels: Record<string, string> = {
    leaf: '叶',
    sprout: '芽',
    scarf: '巾',
    drop: '滴',
    star: '星',
    cap: '帽',
    bow: '结',
    halo: '环',
  }
  return labels[accessory || ''] || ''
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  small: {
    width: 54,
    height: 54,
  },
  medium: {
    width: 82,
    height: 82,
  },
  large: {
    width: 132,
    height: 132,
  },
  shapeRound: {
    borderRadius: 999,
  },
  shapeBean: {
    borderRadius: 30,
    transform: [{ rotate: '-4deg' }],
  },
  shapePuff: {
    borderRadius: 28,
  },
  shapeDrop: {
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 28,
    transform: [{ rotate: '-8deg' }],
  },
  pattern: {
    ...StyleSheet.absoluteFill,
    opacity: 0.34,
  },
  patternPlain: {
    opacity: 0,
  },
  patternStripe: {
    borderTopWidth: 18,
    borderTopColor: 'rgba(255, 255, 255, 0.65)',
  },
  patternRing: {
    borderWidth: 12,
    borderColor: 'rgba(255, 255, 255, 0.58)',
  },
  patternDot: {
    width: '38%',
    height: '38%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    left: '56%',
    top: '16%',
  },
  patternGlow: {
    backgroundColor: 'rgba(255, 255, 255, 0.26)',
  },
  initial: {
    color: colors.text,
    fontWeight: '900',
  },
  smallInitial: {
    fontSize: 20,
  },
  mediumInitial: {
    fontSize: 30,
  },
  largeInitial: {
    fontSize: 46,
  },
  accessory: {
    position: 'absolute',
    right: 7,
    top: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
  },
  smallAccessory: {
    width: 18,
    height: 18,
  },
  mediumAccessory: {
    width: 24,
    height: 24,
  },
  largeAccessory: {
    width: 32,
    height: 32,
  },
  accessoryText: {
    color: colors.brandDark,
    fontSize: 11,
    fontWeight: '900',
  },
  moodDot: {
    position: 'absolute',
    left: 9,
    bottom: 9,
    width: 13,
    height: 13,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#fff',
  },
  moodHappy: {
    backgroundColor: colors.brand,
  },
  moodSleepy: {
    backgroundColor: colors.blue,
  },
  moodSurprised: {
    backgroundColor: colors.orange,
  },
  moodCalm: {
    backgroundColor: colors.textMuted,
  },
  stateMuted: {
    opacity: 0.72,
  },
  stateWarming: {
    borderColor: colors.orange,
  },
})
