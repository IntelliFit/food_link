import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg'
import { derivePetAppearance, type PetAnimal, type PetAppearanceCandidate, type PetProfile } from '@food-link/core'
import { colors } from '../theme'

type PetVisual = Pick<PetProfile | PetAppearanceCandidate, 'pet_seed' | 'name' | 'color' | 'shape' | 'pattern' | 'accessory' | 'personality'>

interface PetAvatarProps {
  pet?: Partial<PetVisual> | null
  size?: 'small' | 'medium' | 'large' | number
  mood?: string
  state?: string
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

export function PetAvatar({ pet, size = 'medium', mood, state }: PetAvatarProps) {
  const appearance = derivePetAppearance(pet)
  const palette = PET_PALETTE[appearance.color] || PET_PALETTE.mint
  const dimmed = state === 'low_power' || state === 'hibernating' || state === 'deep_sleep'
  const label = `${pet?.name || '成长伙伴'}，${petMoodLabel(mood)}，${petStateLabel(state)}`

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="image"
      style={[styles.avatar, typeof size === 'number' ? { width: size, height: size } : styles[size], dimmed && styles.stateMuted, state === 'warming' && styles.stateWarming]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 120 120">
        <Ellipse cx="60" cy="101" rx="34" ry="9" fill="rgba(15, 23, 42, 0.12)" />
        <G opacity={dimmed ? 0.78 : 1}>
          <PetTail animal={appearance.animal} color={palette.body} line={palette.line} />
          <PetEars animal={appearance.animal} color={palette.body} accent={palette.accent} line={palette.line} />
          <PetBody shape={appearance.shape} color={palette.body} line={palette.line} />
          <PetPattern pattern={appearance.pattern} color={palette.accent} line={palette.line} />
          <PetAccessory accessory={appearance.accessory} color={palette.accent} line={palette.line} />
          <PetFace animal={appearance.animal} mood={mood} cheek={palette.cheek} line={palette.line} />
        </G>
        <PetMoodGlow mood={mood} state={state} />
      </Svg>
    </View>
  )
}

function PetBody({ shape, color, line }: { shape?: string; color: string; line: string }) {
  if (shape === 'bean') {
    return <Path d="M36 37 C54 21 84 30 91 53 C100 82 75 101 48 91 C25 83 18 54 36 37 Z" fill={color} stroke={line} strokeWidth="3.2" strokeLinecap="round" />
  }
  if (shape === 'puff') {
    return (
      <G>
        <Circle cx="46" cy="59" r="28" fill={color} stroke={line} strokeWidth="3.2" />
        <Circle cx="72" cy="60" r="31" fill={color} stroke={line} strokeWidth="3.2" />
        <Ellipse cx="60" cy="71" rx="39" ry="31" fill={color} stroke={line} strokeWidth="3.2" />
      </G>
    )
  }
  if (shape === 'drop') {
    return <Path d="M61 24 C84 43 97 62 91 79 C85 98 59 101 43 90 C23 75 30 47 61 24 Z" fill={color} stroke={line} strokeWidth="3.2" strokeLinecap="round" />
  }
  return <Circle cx="60" cy="62" r="36" fill={color} stroke={line} strokeWidth="3.2" />
}

function PetTail({ animal, color, line }: { animal: PetAnimal; color: string; line: string }) {
  if (animal === 'fox') {
    return <Path d="M88 67 C108 57 113 82 92 87 C99 79 98 72 88 67 Z" fill={color} stroke={line} strokeWidth="3" />
  }
  if (animal === 'cat') {
    return <Path d="M87 75 C107 76 104 49 91 54" fill="none" stroke={line} strokeWidth="7" strokeLinecap="round" />
  }
  if (animal === 'bunny') {
    return <Circle cx="90" cy="83" r="10" fill={color} stroke={line} strokeWidth="3" />
  }
  return <Path d="M88 76 C102 72 105 88 91 91" fill="none" stroke={line} strokeWidth="6" strokeLinecap="round" />
}

function PetEars({ animal, color, accent, line }: { animal: PetAnimal; color: string; accent: string; line: string }) {
  if (animal === 'bunny') {
    return (
      <G>
        <Ellipse cx="45" cy="29" rx="10" ry="24" fill={color} stroke={line} strokeWidth="3" transform="rotate(-13 45 29)" />
        <Ellipse cx="74" cy="29" rx="10" ry="24" fill={color} stroke={line} strokeWidth="3" transform="rotate(13 74 29)" />
        <Ellipse cx="45" cy="30" rx="4" ry="15" fill={accent} opacity="0.5" transform="rotate(-13 45 30)" />
        <Ellipse cx="74" cy="30" rx="4" ry="15" fill={accent} opacity="0.5" transform="rotate(13 74 30)" />
      </G>
    )
  }
  if (animal === 'bear' || animal === 'hamster') {
    return (
      <G>
        <Circle cx="38" cy="37" r={animal === 'bear' ? '13' : '10'} fill={color} stroke={line} strokeWidth="3" />
        <Circle cx="82" cy="37" r={animal === 'bear' ? '13' : '10'} fill={color} stroke={line} strokeWidth="3" />
        <Circle cx="38" cy="37" r="5" fill={accent} opacity="0.55" />
        <Circle cx="82" cy="37" r="5" fill={accent} opacity="0.55" />
      </G>
    )
  }
  const fox = animal === 'fox'
  return (
    <G>
      <Path d={fox ? 'M34 43 L43 18 L55 45 Z' : 'M35 44 L43 22 L55 45 Z'} fill={color} stroke={line} strokeWidth="3" strokeLinejoin="round" />
      <Path d={fox ? 'M66 45 L78 18 L88 43 Z' : 'M66 45 L77 22 L86 44 Z'} fill={color} stroke={line} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M42 35 L46 27 L50 37 Z" fill={accent} opacity="0.5" />
      <Path d="M72 37 L77 27 L81 35 Z" fill={accent} opacity="0.5" />
    </G>
  )
}

function PetPattern({ pattern, color, line }: { pattern?: string; color: string; line: string }) {
  if (pattern === 'pattern-1') {
    return (
      <G opacity="0.4">
        <Circle cx="47" cy="50" r="5" fill={color} />
        <Circle cx="76" cy="59" r="4" fill={color} />
        <Circle cx="55" cy="82" r="4" fill={color} />
      </G>
    )
  }
  if (pattern === 'pattern-2') {
    return <Ellipse cx="60" cy="72" rx="21" ry="14" fill="none" stroke={color} strokeWidth="7" opacity="0.36" />
  }
  if (pattern === 'pattern-3') {
    return <Path d="M36 66 C48 80 72 82 88 66 C86 88 70 97 53 93 C39 90 31 80 36 66 Z" fill={color} opacity="0.28" />
  }
  if (pattern === 'pattern-4') {
    return (
      <G opacity="0.32" stroke={line} strokeWidth="4" strokeLinecap="round">
        <Path d="M45 39 L40 54" />
        <Path d="M61 35 L58 52" />
        <Path d="M77 40 L72 55" />
      </G>
    )
  }
  return null
}

function PetAccessory({ accessory, color, line }: { accessory?: string; color: string; line: string }) {
  if (accessory === 'sprout') {
    return (
      <G stroke={line} strokeWidth="2.4" strokeLinecap="round">
        <Path d="M60 30 C57 23 56 19 58 15" />
        <Path d="M58 20 C49 17 46 12 45 8 C54 8 60 12 58 20 Z" fill={color} />
        <Path d="M60 20 C68 15 75 15 79 18 C72 24 66 25 60 20 Z" fill={color} />
      </G>
    )
  }
  if (accessory === 'scarf') {
    return (
      <G>
        <Path d="M32 79 C47 87 72 88 89 78 L87 88 C69 97 49 96 34 88 Z" fill={color} stroke={line} strokeWidth="2.5" />
        <Path d="M74 86 L87 101 L76 101 L67 89 Z" fill={color} stroke={line} strokeWidth="2.5" />
      </G>
    )
  }
  if (accessory === 'drop') {
    return <Path d="M79 31 C86 40 89 46 85 52 C81 59 70 57 69 49 C68 43 73 37 79 31 Z" fill="#7dd3fc" stroke={line} strokeWidth="2.4" />
  }
  if (accessory === 'star') {
    return <Path d="M82 27 L86 36 L96 36 L88 42 L91 52 L82 46 L73 52 L76 42 L68 36 L78 36 Z" fill="#fde047" stroke={line} strokeWidth="2.3" strokeLinejoin="round" />
  }
  if (accessory === 'cap') {
    return (
      <G>
        <Path d="M42 34 C52 23 72 23 82 34 L77 43 C65 38 54 38 45 43 Z" fill={color} stroke={line} strokeWidth="2.5" />
        <Path d="M76 40 C89 41 93 45 92 49 C85 49 79 47 74 43 Z" fill={color} stroke={line} strokeWidth="2.5" />
      </G>
    )
  }
  if (accessory === 'bow') {
    return (
      <G>
        <Path d="M42 34 C31 26 28 45 42 44 Z" fill={color} stroke={line} strokeWidth="2.4" />
        <Path d="M51 34 C63 26 66 45 51 44 Z" fill={color} stroke={line} strokeWidth="2.4" />
        <Circle cx="47" cy="39" r="4" fill={line} />
      </G>
    )
  }
  if (accessory === 'halo') {
    return <Ellipse cx="60" cy="21" rx="22" ry="7" fill="none" stroke="#facc15" strokeWidth="4" opacity="0.78" />
  }
  return <Path d="M38 31 C28 25 26 15 28 9 C40 12 46 21 38 31 Z" fill={color} stroke={line} strokeWidth="2.4" />
}

function PetFace({ animal, mood, cheek, line }: { animal: PetAnimal; mood?: string; cheek: string; line: string }) {
  const sleepy = mood === 'sleepy'
  const surprised = mood === 'surprised'
  const happy = mood === 'happy'
  return (
    <G>
      {animal === 'hamster' || animal === 'bear' ? <Ellipse cx="60" cy="68" rx="18" ry="12" fill="rgba(255,255,255,0.48)" /> : null}
      {sleepy ? (
        <G stroke={line} strokeWidth="3" strokeLinecap="round">
          <Path d="M45 58 C49 61 53 61 56 58" />
          <Path d="M66 58 C70 61 74 61 77 58" />
        </G>
      ) : (
        <G fill={line}>
          <Circle cx="50" cy="58" r={surprised ? '4.5' : '3.6'} />
          <Circle cx="70" cy="58" r={surprised ? '4.5' : '3.6'} />
          <Circle cx="51.5" cy="56.5" r="1.2" fill="#fff" />
          <Circle cx="71.5" cy="56.5" r="1.2" fill="#fff" />
        </G>
      )}
      <Ellipse cx="60" cy="68" rx="8" ry="5" fill="rgba(255,255,255,0.5)" />
      <Path d={surprised ? 'M58 72 C58 68 63 68 63 72 C63 77 58 77 58 72 Z' : happy ? 'M52 72 C56 79 65 79 69 72' : 'M55 72 C58 75 62 75 65 72'} fill="none" stroke={line} strokeWidth="2.6" strokeLinecap="round" />
      <Circle cx="40" cy="68" r="5" fill={cheek} opacity="0.36" />
      <Circle cx="80" cy="68" r="5" fill={cheek} opacity="0.36" />
    </G>
  )
}

function PetMoodGlow({ mood, state }: { mood?: string; state?: string }) {
  if (state === 'warming') return <Circle cx="96" cy="25" r="6" fill={colors.orange} opacity="0.82" />
  if (mood === 'happy') return <Circle cx="96" cy="25" r="6" fill={colors.brand} opacity="0.82" />
  if (mood === 'surprised') return <Circle cx="96" cy="25" r="6" fill={colors.orange} opacity="0.82" />
  if (mood === 'sleepy') return <Circle cx="96" cy="25" r="6" fill={colors.blue} opacity="0.72" />
  return null
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

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
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
  stateMuted: {
    opacity: 0.72,
  },
  stateWarming: {
    shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 3,
  },
})
