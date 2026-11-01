// Everyday wording for the engine's inputs: labels, life cards, sliders and form levels.
// Level values (MET-h, grams, kcal) are product mappings, not parameters from a paper.
import { ALCOHOL, SMOKING, type Alcohol, type Exposures, type Person, type Smoking } from '../engine/engine'

export const SMOKING_LABELS: Record<Smoking, string> = {
  never: '不吸',
  former: '已戒',
  current_lt20: '每天不到 20 支',
  current_ge20: '每天 20 支以上',
}

export const ALCOHOL_LABELS: Record<Alcohol, string> = {
  less_than_daily: '不是每天喝',
  daily_1_29: '每天不到 1.5 两白酒',
  daily_30_59: '每天 1.5–3 两',
  daily_ge60: '每天 3 两以上',
}

export type NumericHabit = 'fruit_g' | 'fish_g' | 'delta_intake_kcal' | 'pa_met_h' | 'sleep_h'

export interface HabitSlider {
  key: NumericHabit
  label: string
  min: number
  max: number
  step: number
  format: (value: number) => string
  hint: (value: number) => string
}

export const HABIT_SLIDERS: HabitSlider[] = [
  {
    key: 'fruit_g', label: '水果', min: 0, max: 400, step: 10,
    format: value => `${Math.round(value)} g/天`,
    hint: value => `约 ${(value / 200).toFixed(1)} 个苹果`,
  },
  {
    key: 'fish_g', label: '鱼和海产品', min: 0, max: 150, step: 5,
    format: value => `${Math.round(value)} g/天`,
    hint: value => `约每周 ${(value * 7 / 100).toFixed(1)} 次，每次 100 g`,
  },
  {
    key: 'delta_intake_kcal', label: '每天比维持体重多吃', min: -600, max: 600, step: 10,
    format: value => `${value > 0 ? '+' : ''}${Math.round(value)} kcal`,
    hint: (value) => {
      if (value > 0) return `约 ${(value / 300).toFixed(1)} 杯奶茶，体重会慢慢涨`
      if (value < 0) return `约少 ${(-value / 240).toFixed(1)} 碗米饭，体重会慢慢降`
      return '体重保持不变'
    },
  },
  {
    key: 'pa_met_h', label: '每天活动量', min: 0, max: 60, step: 1,
    format: value => `${Number.isInteger(value) ? value : value.toFixed(1)} MET-h`,
    hint: () => '久坐上班约 8–12，快走 1 小时约 +4',
  },
  {
    key: 'sleep_h', label: '每晚睡眠', min: 3, max: 12, step: 0.5,
    format: value => `${value} 小时`,
    hint: () => '7–8 小时风险最低',
  },
]

export const HABIT_CHOICES = [
  { key: 'smoking', label: '吸烟', options: SMOKING, names: SMOKING_LABELS },
  { key: 'alcohol', label: '饮酒', options: ALCOHOL, names: ALCOHOL_LABELS },
] as const

export interface LifeCard {
  id: string
  name: string
  detail: string
  applies?: (person: Person) => boolean
  apply: (x: Exposures) => Exposures
}

export const LIFE_CARDS: LifeCard[] = [
  { id: 'apple', name: '每天多吃一个苹果', detail: '水果 +200 g/天', apply: x => ({ ...x, fruit_g: x.fruit_g + 200 }) },
  { id: 'fish', name: '每周多吃两次鱼', detail: '鱼 +30 g/天', apply: x => ({ ...x, fish_g: x.fish_g + 30 }) },
  { id: 'rice', name: '每天少吃半碗米饭', detail: '−120 kcal/天', apply: x => ({ ...x, delta_intake_kcal: x.delta_intake_kcal - 120 }) },
  { id: 'walk', name: '每天快走 40 分钟', detail: '活动 +2.7 MET-h/天', apply: x => ({ ...x, pa_met_h: x.pa_met_h + 2.7 }) },
  {
    id: 'quit', name: '戒烟', detail: '吸烟 → 已戒',
    applies: person => person.smoking === 'current_lt20' || person.smoking === 'current_ge20',
    apply: x => ({ ...x, smoking: x.smoking === 'current_lt20' || x.smoking === 'current_ge20' ? 'former' : x.smoking }),
  },
  { id: 'tea', name: '每天一杯奶茶', detail: '+300 kcal/天', apply: x => ({ ...x, delta_intake_kcal: x.delta_intake_kcal + 300 }) },
  { id: 'late', name: '每晚少睡 1 小时', detail: '睡眠 −1 小时', apply: x => ({ ...x, sleep_h: Math.max(3, x.sleep_h - 1) }) },
  {
    id: 'baijiu', name: '每天喝 2 两白酒', detail: '约 40 g 酒精/天',
    applies: person => person.alcohol !== 'daily_ge60',
    apply: x => ({ ...x, alcohol: ALCOHOL.indexOf(x.alcohol) < 2 ? 'daily_30_59' : x.alcohol }),
  },
  {
    id: 'pack', name: '每天一包烟', detail: '20 支/天',
    applies: person => person.smoking !== 'current_ge20',
    apply: x => ({ ...x, smoking: 'current_ge20' }),
  },
]

export const lifeCardsFor = (person: Person): LifeCard[] => LIFE_CARDS.filter(card => !card.applies || card.applies(person))

export type Level = readonly [label: string, value: number]

export const ACTIVITY_LEVELS: Level[] = [['大多坐着', 8], ['常走动', 14], ['经常站立或运动', 22], ['体力劳动', 35]]
export const SLEEP_LEVELS: Level[] = [['不到 6 小时', 5.5], ['6–7 小时', 6.5], ['7–8 小时', 7.5], ['8 小时以上', 8.5]]
export const FRUIT_LEVELS: Level[] = [['几乎不吃', 10], ['偶尔吃', 60], ['每天一个', 200], ['每天两个以上', 350]]
export const FISH_LEVELS: Level[] = [['几乎不吃', 3], ['每周一次', 15], ['每周两三次', 40], ['几乎每天', 80]]
export const WEIGHT_TREND_LEVELS: Level[] = [['在变胖', 150], ['基本不变', 0], ['在变瘦', -150]]
