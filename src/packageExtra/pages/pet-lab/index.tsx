import { View, Text, ScrollView } from '@tarojs/components'
import { useMemo, useState } from 'react'
import './index.scss'

const PET_COLORS = ['mint', 'berry', 'sunny', 'aqua', 'grape', 'peach', 'cream', 'matcha'] as const
const PET_SHAPES = ['round', 'bean', 'puff', 'drop'] as const
const PET_ANIMALS = ['cat', 'bunny', 'bear', 'fox', 'hamster'] as const
const PET_ACCESSORIES = ['leaf', 'sprout', 'scarf', 'drop', 'star', 'cap', 'bow', 'halo'] as const
const PET_PATTERNS = ['pattern-0', 'pattern-1', 'pattern-2', 'pattern-3', 'pattern-4'] as const
const PET_MOODS = ['calm', 'happy', 'sleepy', 'surprised'] as const
const PET_ARCHETYPES = ['steady_caregiver', 'energetic_buddy', 'gentle_healer', 'protein_guardian', 'light_lifestyle'] as const

type PetColor = typeof PET_COLORS[number]
type PetShape = typeof PET_SHAPES[number]
type PetAnimal = typeof PET_ANIMALS[number]
type PetAccessory = typeof PET_ACCESSORIES[number]
type PetPattern = typeof PET_PATTERNS[number]
type PetMood = typeof PET_MOODS[number]
type PetArchetype = typeof PET_ARCHETYPES[number]
type PetStyle = 'pretty' | 'quirky' | 'stable' | 'risky'

type PetVariant = {
  id: string
  color: PetColor
  shape: PetShape
  animal: PetAnimal
  accessory: PetAccessory
  pattern: PetPattern
  mood: PetMood
  score: number
  note: string
  style: PetStyle
  strengths: string[]
  riskReasons: string[]
  archetypeBoosts: Partial<Record<PetArchetype, number>>
}

type FilterValue = 'all' | string

const COLOR_LABELS: Record<PetColor, string> = {
  mint: '薄荷绿',
  berry: '莓果粉',
  sunny: '暖阳橙',
  aqua: '水蓝',
  grape: '葡萄紫',
  peach: '蜜桃',
  cream: '奶油',
  matcha: '抹茶',
}

const SHAPE_LABELS: Record<PetShape, string> = {
  round: '圆团',
  bean: '豆豆',
  puff: '泡芙',
  drop: '水滴',
}

const ANIMAL_LABELS: Record<PetAnimal, string> = {
  cat: '猫感',
  bunny: '兔感',
  bear: '熊感',
  fox: '狐感',
  hamster: '仓鼠感',
}

const ACCESSORY_LABELS: Record<PetAccessory, string> = {
  leaf: '叶片',
  sprout: '嫩芽',
  scarf: '围巾',
  drop: '水滴',
  star: '星星',
  cap: '帽子',
  bow: '蝴蝶结',
  halo: '光环',
}

const PATTERN_LABELS: Record<PetPattern, string> = {
  'pattern-0': '纯色',
  'pattern-1': '小斑点',
  'pattern-2': '软圆斑',
  'pattern-3': '肚肚纹',
  'pattern-4': '竖条纹',
}

const MOOD_LABELS: Record<PetMood, string> = {
  calm: '平静',
  happy: '开心',
  sleepy: '困困',
  surprised: '惊喜',
}

const STYLE_LABELS: Record<PetStyle, string> = {
  pretty: '漂亮亲和',
  quirky: '特色丑萌',
  stable: '稳定可用',
  risky: '需要收敛',
}

const ARCHETYPE_LABELS: Record<PetArchetype, string> = {
  steady_caregiver: '稳定陪伴',
  energetic_buddy: '元气伙伴',
  gentle_healer: '温柔守护',
  protein_guardian: '蛋白守卫',
  light_lifestyle: '轻盈陪伴',
}

const ARCHETYPE_NOTES: Record<PetArchetype, string> = {
  steady_caregiver: '偏好薄荷、水蓝、奶油色，圆团或泡芙体型，自然配饰和温柔/认真性格。',
  energetic_buddy: '偏好暖阳、水蓝、薄荷色，泡芙或豆豆体型，嫩芽、星星、围巾和元气/运动性格。',
  gentle_healer: '偏好奶油、蜜桃、薄荷色，圆润体型，叶片、光环、蝴蝶结和温柔性格。',
  protein_guardian: '偏好抹茶、水蓝、暖阳色，泡芙或圆团体型，围巾、嫩芽和认真/运动性格。',
  light_lifestyle: '偏好薄荷、奶油、蜜桃色，豆豆或圆团体型，叶片、嫩芽、水滴和轻盈文案。',
}

const ARCHETYPE_PREFS: Record<PetArchetype, {
  colors: readonly PetColor[]
  shapes: readonly PetShape[]
  patterns: readonly PetPattern[]
  accessories: readonly PetAccessory[]
  moods: readonly PetMood[]
}> = {
  steady_caregiver: {
    colors: ['mint', 'aqua', 'cream', 'matcha', 'peach'],
    shapes: ['round', 'puff', 'bean'],
    patterns: ['pattern-0', 'pattern-1', 'pattern-2', 'pattern-3'],
    accessories: ['leaf', 'sprout', 'scarf', 'bow', 'halo'],
    moods: ['calm', 'happy'],
  },
  energetic_buddy: {
    colors: ['sunny', 'aqua', 'mint', 'peach', 'matcha'],
    shapes: ['puff', 'bean', 'round'],
    patterns: ['pattern-0', 'pattern-1', 'pattern-2', 'pattern-3'],
    accessories: ['sprout', 'star', 'scarf', 'leaf', 'bow'],
    moods: ['happy', 'surprised', 'calm'],
  },
  gentle_healer: {
    colors: ['cream', 'peach', 'mint', 'aqua', 'berry'],
    shapes: ['round', 'bean', 'puff'],
    patterns: ['pattern-0', 'pattern-2', 'pattern-1'],
    accessories: ['leaf', 'halo', 'bow', 'sprout', 'scarf'],
    moods: ['calm', 'happy'],
  },
  protein_guardian: {
    colors: ['matcha', 'aqua', 'sunny', 'mint', 'cream'],
    shapes: ['puff', 'round', 'bean'],
    patterns: ['pattern-0', 'pattern-3', 'pattern-1', 'pattern-2'],
    accessories: ['scarf', 'sprout', 'leaf', 'star', 'cap'],
    moods: ['calm', 'happy'],
  },
  light_lifestyle: {
    colors: ['mint', 'cream', 'peach', 'matcha', 'aqua'],
    shapes: ['bean', 'round', 'puff', 'drop'],
    patterns: ['pattern-0', 'pattern-1', 'pattern-2', 'pattern-3'],
    accessories: ['leaf', 'sprout', 'drop', 'bow', 'halo'],
    moods: ['calm', 'happy'],
  },
}

function frontendStableHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function variantNote(score: number): string {
  if (score >= 88) return '高亲和'
  if (score >= 80) return '稳定可用'
  if (score >= 68) return '有特色'
  return '需收敛'
}

function evaluateVariant(variant: Omit<PetVariant, 'id' | 'score' | 'note' | 'style' | 'strengths' | 'riskReasons'>) {
  let score = 74
  const strengths: string[] = []
  const riskReasons: string[] = []

  if (variant.pattern === 'pattern-0') {
    score += 6
    strengths.push('脸部干净')
  }
  if (variant.pattern === 'pattern-1' || variant.pattern === 'pattern-2') {
    score += 4
    strengths.push('花纹柔和')
  }
  if (variant.pattern === 'pattern-3') {
    score += 1
    strengths.push('有身体层次')
  }
  if (variant.pattern === 'pattern-4') {
    score -= 10
    riskReasons.push('竖条纹在小尺寸里容易显乱')
  }

  if (variant.accessory === 'leaf' || variant.accessory === 'sprout') {
    score += 6
    strengths.push('自然配饰亲和')
  }
  if (variant.accessory === 'bow') {
    score += 5
    strengths.push('蝴蝶结更可爱')
  }
  if (variant.accessory === 'scarf') {
    score += 2
    strengths.push('围巾有陪伴感')
  }
  if (variant.accessory === 'cap') {
    score -= 7
    riskReasons.push('帽檐容易变尖锐')
  }
  if (variant.accessory === 'star') {
    score -= 3
    riskReasons.push('星星碎片感偏强')
  }

  if (variant.color === 'cream' || variant.color === 'mint' || variant.color === 'peach' || variant.color === 'aqua') {
    score += 4
    strengths.push('颜色清爽')
  }
  if (variant.color === 'berry' || variant.color === 'matcha') {
    score += 2
    strengths.push('颜色有记忆点')
  }
  if (variant.color === 'grape') {
    score -= 1
    strengths.push('颜色偏抽象')
  }

  if (variant.shape === 'round') {
    score += 3
    strengths.push('圆润安全')
  }
  if (variant.shape === 'puff' || variant.shape === 'bean') {
    score += 2
    strengths.push('轮廓软萌')
  }
  if (variant.shape === 'drop') {
    score -= 4
    riskReasons.push('水滴轮廓更挑组合')
  }

  if (variant.animal === 'bunny' || variant.animal === 'bear' || variant.animal === 'hamster') {
    score += 4
    strengths.push('动物感明确')
  }
  if (variant.animal === 'cat') {
    score += 2
    strengths.push('耳朵识别度高')
  }
  if (variant.animal === 'fox') {
    score -= 2
    strengths.push('狐感更有特色')
  }

  if (variant.mood === 'happy') {
    score += 4
    strengths.push('表情积极')
  }
  if (variant.mood === 'calm') {
    score += 3
    strengths.push('表情稳定')
  }
  if (variant.mood === 'surprised') {
    score -= 4
    riskReasons.push('惊讶嘴型小尺寸略突兀')
  }
  if (variant.mood === 'sleepy') {
    score -= 9
    riskReasons.push('困困眼容易被看成没精神')
  }

  if (variant.color === 'grape' && variant.pattern === 'pattern-4') {
    score -= 8
    riskReasons.push('紫色竖纹容易显脏')
  }
  if (variant.color === 'cream' && variant.mood === 'sleepy') {
    score -= 5
    riskReasons.push('奶油色困困容易像生病')
  }
  if (variant.animal === 'fox' && variant.accessory === 'cap') {
    score -= 8
    riskReasons.push('狐感加帽子会偏尖偏怪')
  }
  if (variant.shape === 'drop' && variant.pattern === 'pattern-4') {
    score -= 7
    riskReasons.push('水滴加竖纹像裂痕')
  }
  if (variant.pattern === 'pattern-4' && variant.accessory === 'cap') {
    score -= 5
    riskReasons.push('竖纹和帽子叠加太杂')
  }

  const hasQuirkyTrait = variant.animal === 'fox'
    || variant.shape === 'drop'
    || variant.color === 'grape'
    || variant.accessory === 'halo'
    || variant.accessory === 'star'
    || variant.pattern === 'pattern-4'
  const finalScore = Math.max(42, Math.min(96, score))
  let style: PetStyle = 'stable'
  if (finalScore < 68 || riskReasons.length >= 3) {
    style = 'risky'
  } else if (hasQuirkyTrait && finalScore >= 70) {
    style = 'quirky'
  } else if (finalScore >= 88) {
    style = 'pretty'
  }

  return {
    score: finalScore,
    note: variantNote(finalScore),
    style,
    strengths: strengths.slice(0, 3),
    riskReasons: riskReasons.slice(0, 3),
    archetypeBoosts: buildArchetypeBoosts(variant),
  }
}

function buildArchetypeBoosts(variant: Omit<PetVariant, 'id' | 'score' | 'note' | 'style' | 'strengths' | 'riskReasons' | 'archetypeBoosts'>): Partial<Record<PetArchetype, number>> {
  const boosts: Partial<Record<PetArchetype, number>> = {}
  PET_ARCHETYPES.forEach((archetype) => {
    const pref = ARCHETYPE_PREFS[archetype]
    let score = 0
    if (pref.colors.includes(variant.color)) score += 2
    if (pref.shapes.includes(variant.shape)) score += 2
    if (pref.patterns.includes(variant.pattern)) score += 2
    if (pref.accessories.includes(variant.accessory)) score += 2
    if (pref.moods.includes(variant.mood)) score += 1
    boosts[archetype] = score
  })
  return boosts
}

function buildVariants(): PetVariant[] {
  const variants: PetVariant[] = []
  PET_COLORS.forEach((color) => {
    PET_SHAPES.forEach((shape) => {
      PET_ANIMALS.forEach((animal) => {
        PET_PATTERNS.forEach((pattern) => {
          PET_ACCESSORIES.forEach((accessory) => {
            const mood = PET_MOODS[frontendStableHash(`${color}:${shape}:${animal}:${pattern}:${accessory}:mood`) % PET_MOODS.length]
            const base = { color, shape, animal, pattern, accessory, mood }
            const evaluation = evaluateVariant(base)
            variants.push({
              ...base,
              id: `${color}-${shape}-${animal}-${pattern}-${accessory}`,
              ...evaluation,
            })
          })
        })
      })
    })
  })
  return variants.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

function pickDiverseVariants(variants: PetVariant[], limit: number): PetVariant[] {
  const picked: PetVariant[] = []
  const usedColors = new Set<string>()
  const usedAnimals = new Set<string>()
  const usedPairs = new Set<string>()

  variants.forEach((variant) => {
    if (picked.length >= limit) return
    const pair = `${variant.color}:${variant.animal}`
    const hasNewColor = !usedColors.has(variant.color)
    const hasNewAnimal = !usedAnimals.has(variant.animal)
    if (!usedPairs.has(pair) && (picked.length < 3 || hasNewColor || hasNewAnimal)) {
      picked.push(variant)
      usedPairs.add(pair)
      usedColors.add(variant.color)
      usedAnimals.add(variant.animal)
    }
  })

  variants.forEach((variant) => {
    if (picked.length >= limit) return
    if (!picked.some((item) => item.id === variant.id)) picked.push(variant)
  })

  return picked
}

function pickByFnv(seed: string, values: readonly string[]): string {
  return values[fnv1aHash(seed) % values.length]
}

function pickByFrontendHash(seed: string, values: readonly string[]): string {
  return values[frontendStableHash(seed) % values.length]
}

function seedExample(seed: string) {
  return {
    color: pickByFnv(`${seed}:color`, PET_COLORS),
    shape: pickByFnv(`${seed}:shape`, PET_SHAPES),
    pattern: pickByFnv(`${seed}:pattern`, PET_PATTERNS),
    accessory: pickByFnv(`${seed}:accessory`, PET_ACCESSORIES),
    animal: pickByFrontendHash(`${seed}:animal`, PET_ANIMALS),
  }
}

function FilterPills({
  title,
  value,
  options,
  labels,
  onChange,
}: {
  title: string
  value: FilterValue
  options: readonly string[]
  labels: Record<string, string>
  onChange: (value: FilterValue) => void
}) {
  return (
    <View className='pet-lab-filter'>
      <Text className='pet-lab-filter-title'>{title}</Text>
      <ScrollView scrollX className='pet-lab-filter-scroll' showScrollbar={false}>
        <View className='pet-lab-filter-row'>
          <View className={`pet-lab-pill ${value === 'all' ? 'active' : ''}`} onClick={() => onChange('all')}>
            <Text className='pet-lab-pill-text'>全部</Text>
          </View>
          {options.map((option) => (
            <View
              key={option}
              className={`pet-lab-pill ${value === option ? 'active' : ''}`}
              onClick={() => onChange(option)}
            >
              <Text className='pet-lab-pill-text'>{labels[option] || option}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function PetFigure({ variant, small = false }: { variant: PetVariant; small?: boolean }) {
  return (
    <View className={`pet-lab-avatar ${small ? 'small' : ''} ${variant.color} ${variant.shape} ${variant.pattern} animal-${variant.animal} mood-${variant.mood}`}>
      <View className='pet-lab-shadow' />
      <View className='pet-body'>
        <View className='pet-tail' />
        <View className='pet-ear left' />
        <View className='pet-ear right' />
        <View className='pet-accessory'>
          <View className={`pet-accessory-shape ${variant.accessory}`} />
        </View>
        <View className='pet-face'>
          <View className='pet-snout' />
          <View className='pet-eye left' />
          <View className='pet-eye right' />
          <View className='pet-cheek left' />
          <View className='pet-cheek right' />
          <View className='pet-mouth' />
        </View>
      </View>
    </View>
  )
}

function PetLabPage() {
  const [color, setColor] = useState<FilterValue>('all')
  const [shape, setShape] = useState<FilterValue>('all')
  const [animal, setAnimal] = useState<FilterValue>('all')
  const [pattern, setPattern] = useState<FilterValue>('all')
  const [accessory, setAccessory] = useState<FilterValue>('all')
  const [quality, setQuality] = useState<FilterValue>('all')
  const [archetype, setArchetype] = useState<FilterValue>('all')
  const [visibleCount, setVisibleCount] = useState(80)
  const [selected, setSelected] = useState<PetVariant | null>(null)

  const variants = useMemo(buildVariants, [])
  const filtered = useMemo(() => {
    return variants.filter((variant) => {
      if (color !== 'all' && variant.color !== color) return false
      if (shape !== 'all' && variant.shape !== shape) return false
      if (animal !== 'all' && variant.animal !== animal) return false
      if (pattern !== 'all' && variant.pattern !== pattern) return false
      if (accessory !== 'all' && variant.accessory !== accessory) return false
      if (quality === 'good' && variant.score < 88) return false
      if (quality === 'ok' && (variant.score < 68 || variant.score >= 88)) return false
      if (quality === 'risky' && variant.score >= 68) return false
      if (archetype !== 'all' && (variant.archetypeBoosts[archetype as PetArchetype] || 0) < 6) return false
      return true
    })
  }, [accessory, animal, archetype, color, pattern, quality, shape, variants])

  const shown = filtered.slice(0, visibleCount)
  const topExamples = pickDiverseVariants(variants.filter((variant) => variant.score >= 88 && variant.mood !== 'sleepy' && variant.style !== 'risky'), 8)
  const quirkyExamples = pickDiverseVariants(variants.filter((variant) => variant.style === 'quirky' && variant.score >= 72 && variant.score < 88), 8)
  const riskyExamples = pickDiverseVariants(variants.filter((variant) => variant.style === 'risky'), 8)
  const seedDemo = seedExample('pet:user-id')
  const totalCount = PET_COLORS.length * PET_SHAPES.length * PET_ANIMALS.length * PET_PATTERNS.length * PET_ACCESSORIES.length

  const handleFilter = (setter: (value: FilterValue) => void) => (value: FilterValue) => {
    setter(value)
    setVisibleCount(80)
  }

  return (
    <View className='pet-lab-page'>
      <View className='pet-lab-hero'>
        <Text className='pet-lab-title'>宠物外观试验箱</Text>
        <Text className='pet-lab-subtitle'>
          当前基础组合 {totalCount} 种。这里把生成规则、参数和风险组合摊开，方便我们把“有特色”和“真丑”分开。
        </Text>
        <View className='pet-lab-stat-row'>
          <View className='pet-lab-stat'>
            <Text className='pet-lab-stat-value'>{PET_COLORS.length}</Text>
            <Text className='pet-lab-stat-label'>颜色</Text>
          </View>
          <View className='pet-lab-stat'>
            <Text className='pet-lab-stat-value'>{PET_SHAPES.length}</Text>
            <Text className='pet-lab-stat-label'>体型</Text>
          </View>
          <View className='pet-lab-stat'>
            <Text className='pet-lab-stat-value'>{PET_ANIMALS.length}</Text>
            <Text className='pet-lab-stat-label'>动物特征</Text>
          </View>
          <View className='pet-lab-stat'>
            <Text className='pet-lab-stat-value'>{PET_PATTERNS.length * PET_ACCESSORIES.length}</Text>
            <Text className='pet-lab-stat-label'>纹样配饰</Text>
          </View>
        </View>
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>生成原理</Text>
        <Text className='pet-lab-copy'>
          新规则先用健康档案生成画像倾向，再用权重和审美护栏生成三候选。后端仍用 FNV-1a hash 保持稳定，首页和详情页再用同一个 seed 派生动物特征。
        </Text>
        <View className='pet-lab-formula'>
          <Text className='pet-lab-code'>FNV(seed + color) % {PET_COLORS.length} = {String(seedDemo.color)}</Text>
          <Text className='pet-lab-code'>FNV(seed + shape) % {PET_SHAPES.length} = {String(seedDemo.shape)}</Text>
          <Text className='pet-lab-code'>FNV(seed + pattern) % {PET_PATTERNS.length} = {String(seedDemo.pattern)}</Text>
          <Text className='pet-lab-code'>FNV(seed + accessory) % {PET_ACCESSORIES.length} = {String(seedDemo.accessory)}</Text>
          <Text className='pet-lab-code'>前端 hash(seed + animal) % {PET_ANIMALS.length} = {String(seedDemo.animal)}</Text>
        </View>
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>画像倾向</Text>
        <Text className='pet-lab-copy'>
          画像只改变外观权重和文案倾向，不按性别直接分颜色或动物。选择下面任意一种，可以看到它更容易推高哪些组合。
        </Text>
        <FilterPills title='画像' value={archetype} options={PET_ARCHETYPES} labels={ARCHETYPE_LABELS} onChange={handleFilter(setArchetype)} />
        {archetype !== 'all' ? (
          <View className='pet-lab-archetype-note'>
            <Text className='pet-lab-archetype-note-text'>{ARCHETYPE_NOTES[archetype as PetArchetype]}</Text>
          </View>
        ) : null}
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>推荐样本</Text>
        <Text className='pet-lab-copy'>这里不再只取最高分，而是强制拉开颜色和动物特征，避免最后上线全长一个样。</Text>
        <ScrollView scrollX className='pet-lab-sample-scroll' showScrollbar={false}>
          <View className='pet-lab-sample-row'>
            {topExamples.map((variant) => (
              <View key={variant.id} className={`pet-lab-sample-card ${variant.style}`} onClick={() => setSelected(variant)}>
                <PetFigure variant={variant} small />
                <Text className='pet-lab-sample-title'>{variant.note}</Text>
                <Text className='pet-lab-sample-sub'>{variant.score} · {STYLE_LABELS[variant.style]}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>特色样本</Text>
        <Text className='pet-lab-copy'>这些可以保留“丑萌/抽象”的个性，但分数必须过审美护栏，不能像脏、伤、病。</Text>
        <ScrollView scrollX className='pet-lab-sample-scroll' showScrollbar={false}>
          <View className='pet-lab-sample-row'>
            {quirkyExamples.map((variant) => (
              <View key={variant.id} className={`pet-lab-sample-card ${variant.style}`} onClick={() => setSelected(variant)}>
                <PetFigure variant={variant} small />
                <Text className='pet-lab-sample-title'>{variant.note}</Text>
                <Text className='pet-lab-sample-sub'>{variant.score} · {STYLE_LABELS[variant.style]}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>风险样本</Text>
        <Text className='pet-lab-copy'>这些不是要删除多样性，而是提醒我们哪些组合容易显脏、显乱或太尖锐。</Text>
        <ScrollView scrollX className='pet-lab-sample-scroll' showScrollbar={false}>
          <View className='pet-lab-sample-row'>
            {riskyExamples.map((variant) => (
              <View key={variant.id} className='pet-lab-sample-card risky' onClick={() => setSelected(variant)}>
                <PetFigure variant={variant} small />
                <Text className='pet-lab-sample-title'>{variant.note}</Text>
                <Text className='pet-lab-sample-sub'>{variant.riskReasons[0] || `${variant.score}`}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className='pet-lab-panel'>
        <Text className='pet-lab-panel-title'>筛选组合</Text>
        <FilterPills title='质量' value={quality} options={['good', 'ok', 'risky']} labels={{ good: '高亲和', ok: '有特色', risky: '需收敛' }} onChange={handleFilter(setQuality)} />
        <FilterPills title='画像' value={archetype} options={PET_ARCHETYPES} labels={ARCHETYPE_LABELS} onChange={handleFilter(setArchetype)} />
        <FilterPills title='颜色' value={color} options={PET_COLORS} labels={COLOR_LABELS} onChange={handleFilter(setColor)} />
        <FilterPills title='体型' value={shape} options={PET_SHAPES} labels={SHAPE_LABELS} onChange={handleFilter(setShape)} />
        <FilterPills title='动物' value={animal} options={PET_ANIMALS} labels={ANIMAL_LABELS} onChange={handleFilter(setAnimal)} />
        <FilterPills title='花纹' value={pattern} options={PET_PATTERNS} labels={PATTERN_LABELS} onChange={handleFilter(setPattern)} />
        <FilterPills title='配饰' value={accessory} options={PET_ACCESSORIES} labels={ACCESSORY_LABELS} onChange={handleFilter(setAccessory)} />
      </View>

      <View className='pet-lab-grid-head'>
        <Text className='pet-lab-grid-title'>当前筛选 {filtered.length} 种</Text>
        <Text className='pet-lab-grid-side'>已展示 {shown.length}</Text>
      </View>

      <View className='pet-lab-grid'>
        {shown.map((variant) => (
          <View key={variant.id} className={`pet-lab-card ${variant.style}`} onClick={() => setSelected(variant)}>
            <PetFigure variant={variant} />
            <Text className='pet-lab-card-title'>{variant.note} · {variant.score}</Text>
            <Text className='pet-lab-card-badge'>{STYLE_LABELS[variant.style]}</Text>
            <Text className='pet-lab-card-desc'>
              {COLOR_LABELS[variant.color]} / {SHAPE_LABELS[variant.shape]} / {ANIMAL_LABELS[variant.animal]}
            </Text>
            <Text className='pet-lab-card-desc'>
              {PATTERN_LABELS[variant.pattern]} / {ACCESSORY_LABELS[variant.accessory]} / {MOOD_LABELS[variant.mood]}
            </Text>
            <Text className={`pet-lab-card-reason ${variant.riskReasons.length ? 'warn' : ''}`}>
              {(archetype !== 'all' ? `${ARCHETYPE_LABELS[archetype as PetArchetype]}匹配 ${variant.archetypeBoosts[archetype as PetArchetype] || 0}` : variant.riskReasons[0] || variant.strengths[0] || '组合稳定')}
            </Text>
          </View>
        ))}
      </View>

      {shown.length < filtered.length ? (
        <View className='pet-lab-load-more' onClick={() => setVisibleCount((prev) => prev + 80)}>
          <Text className='pet-lab-load-more-text'>继续加载 80 个</Text>
        </View>
      ) : null}

      {selected ? (
        <View className='pet-lab-detail-mask' onClick={() => setSelected(null)}>
          <View className='pet-lab-detail' onClick={(event) => event.stopPropagation()}>
            <PetFigure variant={selected} />
            <Text className='pet-lab-detail-title'>{selected.note} · {selected.score}</Text>
            <Text className='pet-lab-detail-copy'>组合 ID：{selected.id}</Text>
            <Text className='pet-lab-detail-copy'>风格判断：{STYLE_LABELS[selected.style]}</Text>
            {archetype !== 'all' ? (
              <Text className='pet-lab-detail-copy'>
                当前画像匹配：{ARCHETYPE_LABELS[archetype as PetArchetype]} · {selected.archetypeBoosts[archetype as PetArchetype] || 0}
              </Text>
            ) : null}
            <View className='pet-lab-detail-tags'>
              <Text className='pet-lab-detail-tag'>{COLOR_LABELS[selected.color]}</Text>
              <Text className='pet-lab-detail-tag'>{SHAPE_LABELS[selected.shape]}</Text>
              <Text className='pet-lab-detail-tag'>{ANIMAL_LABELS[selected.animal]}</Text>
              <Text className='pet-lab-detail-tag'>{PATTERN_LABELS[selected.pattern]}</Text>
              <Text className='pet-lab-detail-tag'>{ACCESSORY_LABELS[selected.accessory]}</Text>
              <Text className='pet-lab-detail-tag'>{MOOD_LABELS[selected.mood]}</Text>
            </View>
            <View className='pet-lab-detail-reasons'>
              {selected.strengths.map((item) => (
                <Text key={item} className='pet-lab-detail-reason good'>{item}</Text>
              ))}
              {selected.riskReasons.map((item) => (
                <Text key={item} className='pet-lab-detail-reason warn'>{item}</Text>
              ))}
            </View>
            <Text className='pet-lab-detail-close'>点空白处关闭</Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default PetLabPage
